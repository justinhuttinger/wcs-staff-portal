-- Conditional membership: insurance plans that only count when the member
-- actually turns up.
--
-- WHY
--
-- Insurance programmes (Active&Fit, Active Adult) enrol people who never set
-- foot in a club. Measured over 60 days:
--
--   A2 CORE - Active Adult Core     1,845 active,   175 live   ( 9.5%)
--   Active and Fit Limited          1,061 active,   132 live   (12.4%)
--   ...against every other type    14,107 active, 9,366 live   (66.4%)
--
-- So 2,599 of 2,906 people on those two plans have not visited in two months
-- while still counting as members — inflating the active count by 13%.
--
-- The rule is deliberately a CHECK-IN test rather than a plan exclusion,
-- because plan type alone is the wrong discriminator: A2 EXEC is 76% live and
-- excluding it wholesale would delete 562 genuine members. Only the two plans
-- seeded below are conditional; everything else counts unconditionally.

create table if not exists public.abc_conditional_membership_types (
  membership_type    text primary key,
  active_within_days integer not null default 60,
  note               text,
  created_at         timestamptz not null default now()
);

comment on table public.abc_conditional_membership_types is
  'Membership types that only count toward member totals when the member has checked in within active_within_days. Empty table = every type counts unconditionally.';

insert into public.abc_conditional_membership_types (membership_type, active_within_days, note)
values
  ('A2 CORE - Active Adult Core', 60, 'Insurance plan; 9.5% checked in within 60 days'),
  ('Active and Fit Limited',      60, 'Insurance plan; 12.4% checked in within 60 days')
on conflict (membership_type) do nothing;

-- One definition of "counts as a member", so no report can drift from another.
--
-- NOTE this is a POINT-IN-TIME view: abc_members stores only each member's
-- LATEST check-in, so it answers "does this person count today" and nothing
-- else. It must NOT be used to reconstruct historical months — applying
-- today's liveness to last March would retroactively delete members who were
-- genuinely active then and invent a collapse that never happened. Backdating
-- needs per-member check-in history; see abc_member_checkin_months below.
create or replace view public.abc_members_counted as
select
  m.*,
  c.membership_type is not null as is_conditional_type,
  case
    when c.membership_type is null then true
    -- A missing or unparseable timestamp means they have never checked in,
    -- which is not-live. Left to SQL's NULL semantics this row would fall out
    -- of both the live and not-live counts and silently vanish.
    when m.last_check_in_timestamp is null then false
    when m.last_check_in_timestamp !~ '^\d{4}-\d{2}-\d{2}' then false
    when left(m.last_check_in_timestamp, 10)::date >= current_date - c.active_within_days then true
    else false
  end as counts_as_member
from public.abc_members m
left join public.abc_conditional_membership_types c
  on c.membership_type = m.membership_type;

comment on view public.abc_members_counted is
  'abc_members plus counts_as_member. POINT IN TIME ONLY - never use to rebuild historical headcounts.';

-- Per-member, per-month check-in counts, so the liveness rule can eventually be
-- answered for a PAST date instead of only for today.
--
-- Filled by ghl-sync/scripts/backfill-member-checkin-months.js. ABC's
-- /members/checkins/summaries returns per-member counts for a date range but
-- carries no per-check-in dates, and it rejects any range longer than 14 days
-- (with an HTTP 200 and the complaint buried in status.message), so the
-- backfill walks month-aligned chunks of 14 days or fewer and sums them.
create table if not exists public.abc_member_checkin_months (
  club_number text    not null,
  member_id   text    not null,
  month       date    not null,
  checkins    integer not null default 0,
  fetched_at  timestamptz not null default now(),
  primary key (club_number, member_id, month)
);

comment on table public.abc_member_checkin_months is
  'Per-member check-ins per month, from ABC /members/checkins/summaries in <=14-day chunks. Enables historical liveness; abc_members only holds the latest check-in.';

create index if not exists idx_member_checkin_months_month
  on public.abc_member_checkin_months (month, club_number);

create index if not exists idx_member_checkin_months_member
  on public.abc_member_checkin_months (member_id, month desc);

alter table public.abc_conditional_membership_types enable row level security;
alter table public.abc_member_checkin_months        enable row level security;
