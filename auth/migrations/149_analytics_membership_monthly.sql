-- 149_analytics_membership_monthly.sql
--
-- Analytics > Membership Snapshot: the whole club rather than one salesperson.
--
-- This adds only the month-by-month series. The headline window already exists
-- as analytics_topline_window, and is reused rather than restated so the
-- snapshot cannot disagree with Topline about how many members joined. That
-- function was checked against the sum of analytics_net_membership across the
-- seven clubs for August 2026 and matched exactly: 529 new, 563 lost.
--
-- Each month is measured with the SAME functions the headline uses, called once
-- per month through a lateral join. Deriving losses from the change in the
-- member count instead would have been wrong: total_members is a point-in-time
-- stock with the conditional-membership rule applied, so its month-to-month
-- delta also moves when a member crosses the "no visit in two months" line,
-- which is not a join and not a cancellation.

create or replace function public.analytics_membership_monthly(
  p_end date,
  p_months integer default 13,
  p_clubs text[] default null,
  p_exclude boolean default true
)
returns table (
  month_start date,
  total_members bigint,
  new_members bigint,
  lost_members bigint,
  net_members bigint,
  new_dues numeric,
  revenue numeric,
  pt_revenue numeric,
  checkins bigint,
  has_checkin_data boolean
)
language sql
stable
as $$
  with months as (
    select generate_series(
      date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    )::date as m
  ),
  bounds as (
    -- The newest month stops at p_end so the current month is compared like for
    -- like against the same day of earlier months, not against whole ones.
    select m as start_d,
           least((m + interval '1 month' - interval '1 day')::date, p_end) as end_d
    from months
  )
  select
    b.start_d,
    coalesce(public.analytics_topline_members_as_of(b.end_d, p_clubs, p_exclude), 0)::bigint,
    coalesce(w.new_members, 0),
    coalesce(w.lost_members, 0),
    coalesce(w.new_members, 0) - coalesce(w.lost_members, 0),
    coalesce(w.new_dues, 0),
    coalesce(w.revenue, 0),
    coalesce(w.pt_revenue, 0),
    coalesce(w.checkins, 0),
    coalesce(w.has_checkin_data, false)
  from bounds b
  left join lateral public.analytics_topline_window(b.start_d, b.end_d, p_clubs, p_exclude) w on true
  order by b.start_d
$$;
