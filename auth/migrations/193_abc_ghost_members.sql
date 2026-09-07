-- 193: members ABC no longer returns, moved out of the counted table.
--
-- THE BUG
--
-- abc_members is upsert-only. Nothing has ever removed a row. When ABC drops a
-- member — transferred to another club, deleted, merged — our row freezes at
-- whatever it last said and keeps counting as Active forever.
--
-- Measured 2026-09-07 against a full active+inactive pull for club 30935:
--
--   rows we hold for 30935            8,461
--   member ids ABC returns            8,430
--   held but never returned              31
--   rows with a null is_primary_member   31   <- the SAME 31, id for id
--
-- Company-wide that is 356 rows, 325 of them still reading Active:
--
--   100  transferred club and are active at the new one too, so every
--        company-wide total counted them TWICE
--    12  are active only on the frozen row; they have actually left
--   213  are gone from ABC entirely and still counted as members
--
-- It also explains a puzzle that looked like a backfill failure. Migration
-- 123's backfill only writes rows ABC hands back, so a ghost can never receive
-- is_primary_member — the null set and the ghost set are the same set. Nothing
-- was wrong with the backfill; re-running it would change nothing.
--
-- WHY REMOVE THE ROW RATHER THAN FLAG IT
--
-- Eighteen SQL functions and about ten JS callers read abc_members directly.
-- A flag would have to be honoured in all twenty-eight, and the one that got
-- missed would be a silently wrong report. Taking the row out of the table
-- fixes every reader at once and cannot be forgotten. Nothing references
-- abc_members by foreign key, so no row anywhere is orphaned by this.
--
-- Nothing is destroyed: the row moves to abc_members_ghosted whole. If ABC
-- starts returning the member again the ordinary upsert re-creates them, so
-- the correction is self-healing in both directions.
--
-- WHAT IT DOES TO THE REPORTS
--
-- Every member report reconstructs history from current state, so a ghost with
-- since_date 2019 was being counted in EVERY month back to 2019. Removing it
-- removes it from every month at once: the level drops about 325 uniformly
-- across the whole series and no single month shows a step. Losses key on
-- member_status_date across Cancelled/Expired/Return For Collection and ghosts
-- are frozen on Active, so they were never counted as losses and none is
-- created here. Growth, net and attrition are unchanged; only the level moves.
--
-- The exception is membership_daily_snapshots, which freezes values instead of
-- recomputing. Its five existing days are restated by the one-time script so
-- the recorded series has no notch either.

create table if not exists public.abc_members_ghosted (
  -- Column-for-column with abc_members, so a row moves across whole and can be
  -- put back by name. NOTE: a future column added to abc_members must be added
  -- here too, or abc_ghost_members() below will fail loudly on the next run.
  like public.abc_members including defaults
);

alter table public.abc_members_ghosted
  add column if not exists ghosted_at   timestamptz not null default now(),
  add column if not exists ghost_reason text;

comment on table public.abc_members_ghosted is
  'Members ABC stopped returning, moved out of abc_members so they stop counting. Append-only audit trail: a member who reappears is re-created in abc_members by the ordinary upsert and their archived row stays here as history.';

-- Deliberately no primary key. A member can legitimately be archived, return,
-- and be archived again, and each of those is a separate fact worth keeping.
create index if not exists abc_members_ghosted_member_idx
  on public.abc_members_ghosted (member_id, club_number);
create index if not exists abc_members_ghosted_when_idx
  on public.abc_members_ghosted (ghosted_at desc);

alter table public.abc_members_ghosted enable row level security;

-- ---------------------------------------------------------------------------
-- The move, as one statement.
--
-- Archive-then-delete from the application would leave rows deleted but not
-- archived if the process died between the two calls. Here the delete and the
-- insert are the same statement, so it is all or nothing.
-- ---------------------------------------------------------------------------
create or replace function public.abc_ghost_members(
  p_club       text,
  p_member_ids text[],
  p_reason     text default 'absent from ABC member list'
)
returns integer
language plpgsql
as $function$
declare
  moved_count integer;
begin
  if p_member_ids is null or array_length(p_member_ids, 1) is null then
    return 0;
  end if;

  with gone as (
    delete from public.abc_members m
     where m.club_number = p_club
       and m.member_id = any(p_member_ids)
    returning m.*
  ),
  archived as (
    insert into public.abc_members_ghosted
    select gone.*, now(), p_reason from gone
    returning 1
  )
  select count(*) into moved_count from archived;

  return moved_count;
end
$function$;

comment on function public.abc_ghost_members(text, text[], text) is
  'Move members out of abc_members into abc_members_ghosted in one statement. Called by the ABC sync once per club per cycle, and only for ids the sync has confirmed absent from a full ABC pull.';
