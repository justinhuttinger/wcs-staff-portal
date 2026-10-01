-- 225: per-member check-ins per DAY (ghl-sync src/abc/checkinDays.js).
--
-- abc_member_checkin_months is too coarse for "X visits in Y days" check-in
-- celebrations (Admin -> Check-in Celebrations). This holds one row per member
-- per Pacific calendar day they checked in, from ABC
-- /members/checkins/summaries with a one-day range. Refreshed nightly (last
-- few days), backfilled once for 365 days, pruned past 400 days. Written by
-- ghl-sync's service role only.

create table if not exists public.abc_member_checkin_days (
  club_number text        not null,   -- club the check-ins happened at
  member_id   text        not null,
  day         date        not null,   -- Pacific calendar day
  checkins    integer     not null default 0,
  fetched_at  timestamptz not null default now(),
  primary key (club_number, member_id, day)
);

-- "This member's visits in a date window" (all clubs).
create index if not exists idx_member_checkin_days_member_day
  on public.abc_member_checkin_days (member_id, day);
-- Pruning + "first day of data".
create index if not exists idx_member_checkin_days_day
  on public.abc_member_checkin_days (day);

-- Service role only (portal-wide convention): RLS on, no policies.
alter table public.abc_member_checkin_days enable row level security;

notify pgrst, 'reload schema';
