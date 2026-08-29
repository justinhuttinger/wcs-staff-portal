-- 172_analytics_daily_series.sql
--
-- A day-by-day series for Analytics > Daily Snapshot.
--
-- BUILT BY CALLING THE EXISTING WINDOW FUNCTIONS ONCE PER DAY, deliberately,
-- rather than reimplementing their aggregation with date_trunc('day').
--
-- Every measure here — a new member, a lost member, a Day One, a PT sale, the
-- 90-day resign rule — already has exactly one definition, in
-- analytics_topline_window and analytics_pt_snapshot. A daily copy would be a
-- second definition that agrees today and drifts the first time either is
-- amended, and the whole point of a daily report is that its numbers add up to
-- the monthly one.
--
-- THE COST IS REAL AND WAS MEASURED AT THE SHIPPING WIDTH, not at a convenient
-- one. Fourteen days runs in 2,030 ms: the member CTE re-scans 95,495 rows per
-- day and the sub-aggregates run once per day (loops=14 in the plan). That is
-- the same lateral-over-an-expensive-function shape that made
-- analytics_membership_monthly take 12 seconds when it was measured at four
-- months instead of thirteen.
--
-- It is acceptable HERE and only here because:
--   - the width is fixed at 14 days and cannot be widened by a filter,
--   - it sits behind the route's 10-minute cache,
--   - 2.0s matches analytics_member_journey, which is already in production.
--
-- If this ever needs 30+ days, do NOT just raise p_days: rewrite it as a single
-- pass and accept the duplicated definitions, or precompute nightly.

create or replace function public.analytics_daily_series(
  p_end date,
  p_days int default 14,
  p_clubs text[] default null
)
returns table (
  day date,
  new_members bigint,
  lost_members bigint,
  net_members bigint,
  new_dues numeric,
  revenue numeric,
  pt_revenue numeric,
  day_ones bigint,
  day_ones_completed bigint,
  day_ones_sold bigint,
  pt_new_sales bigint,
  pt_new_clients bigint,
  pt_new_value numeric,
  pt_lost_count bigint,
  pt_lost_value numeric
)
language sql
stable
as $$
  select
    d.day::date,
    w.new_members,
    w.lost_members,
    (w.new_members - w.lost_members),
    w.new_dues,
    w.revenue,
    w.pt_revenue,
    p.day_ones,
    p.day_ones_completed,
    p.day_ones_sold,
    p.new_sales,
    p.new_clients,
    p.new_value,
    p.lost_count,
    p.lost_value
  from generate_series(
    (p_end - (greatest(p_days, 1) - 1))::date,
    p_end::date,
    interval '1 day'
  ) d(day)
  -- p_exclude is true to match Club Snapshot: the same members are excluded
  -- from both, so a day here rolls up into the month there.
  cross join lateral public.analytics_topline_window(d.day::date, d.day::date, p_clubs, true) w
  cross join lateral public.analytics_pt_snapshot(d.day::date, d.day::date, p_clubs) p
  order by 1
$$;
