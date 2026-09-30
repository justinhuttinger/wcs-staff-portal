-- 219: check-in milestone alerts (ghl-sync src/abc/checkinMilestonesJob.js).
--
-- A member one visit short of a milestone (10, 25, 50, 100, ...) gets a
-- show-once ABC alert, "CELEBRATE 10TH VISIT!", so the front desk sees it on
-- the milestone check-in. One row per member per milestone posted.
--
-- ABC alerts can't be listed or deleted through the API, so this table is the
-- only thing that stops a member sitting on 9 visits getting a fresh alert
-- every night until they come back. Written by ghl-sync's service role only.

create table if not exists public.checkin_milestone_alerts (
  club_number  text        not null,
  member_id    text        not null,
  milestone    integer     not null,
  visits       integer     not null,          -- lifetime count when posted
  alert_text   text        not null,
  color        text        not null,          -- ABC alert colour used
  posted_at    timestamptz not null default now(),
  abc_response jsonb,
  primary key (club_number, member_id, milestone)
);

-- "Who got which milestone alert lately."
create index if not exists checkin_milestone_alerts_posted
  on public.checkin_milestone_alerts (posted_at desc);

-- Service role only (portal-wide convention): RLS on, no policies.
alter table public.checkin_milestone_alerts enable row level security;

-- Lifetime check-ins for a club's active members, summed across every club
-- they visited. Aggregated server-side so the job doesn't page hundreds of
-- thousands of month rows. Ordered so .range() pagination is stable.
create or replace function public.checkin_milestone_totals(p_club text)
returns table (member_id text, visits bigint)
language sql
stable
set search_path = public
as $$
  select m.member_id, sum(c.checkins)::bigint as visits
  from abc_members m
  join abc_member_checkin_months c on c.member_id = m.member_id
  where m.club_number = p_club
    and m.is_active = true
    and m.member_status = 'Active'
  group by m.member_id
  order by m.member_id
$$;

revoke all on function public.checkin_milestone_totals(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
