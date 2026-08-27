-- 131: point Club Activity Trends and Topline at the accurate check-in source.
--
-- WHY
--
-- Both reports read checkins_hourly. That table's buckets are written from the
-- top of each hour up to the moment of the sync tick and are never revisited,
-- so every hour loses the minutes after its last tick. Measured against ABC
-- directly, capture was ~100% through April 2026 and then fell away:
--
--     Apr 2026  ~100%      Jun 2026   70.2%
--     May 2026    75.7%    Jul 2026   56.9%
--
-- Because the shortfall grows with time, the reports were drawing a check-in
-- COLLAPSE that never happened. Real traffic ROSE: 77k in January to 86k in
-- July, +24.8% year on year.
--
-- abc_member_checkin_months (migration 126, backfilled 25 months / 48,290
-- members / 239,228 rows) is complete, and carries one row per member per
-- month. That also yields a TRUE unique-member count; checkins_hourly counted
-- uniques per HOUR, so a member visiting twice in a day counted twice and its
-- "unique" figure sat near the total.
--
-- THE COST
--
-- The accurate source is monthly. It cannot answer a 30-day or month-to-date
-- window, so Topline's check-in card compares whole months instead: the last
-- COMPLETE month against the same month a year earlier. Month-to-date would be
-- worse than coarse: on the 3rd it would measure three days against a full
-- year-ago month and print a 90% collapse. A coarser right number beats a
-- precise wrong one.
--
-- checkins_hourly is left in place; this migration only stops the analytics
-- reports reading it.

create or replace function public.analytics_club_activity(
  p_end     date,
  p_months  integer default 25,
  p_clubs   text[]  default null,
  p_exclude boolean default true
)
returns table (
  month_start      date,
  total_members    bigint,
  new_member_units bigint,
  lost_members     bigint,
  total_checkins   bigint,
  unique_checkins  bigint,
  total_revenue    numeric,
  pt_revenue       numeric,
  has_checkin_data boolean
)
language sql
stable
as $$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  mem as (
    select m.*
    from public.abc_members m
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (
        not p_exclude
        or lower(coalesce(m.membership_type, '')) not in (select t from skip)
      )
  ),
  months as (
    select generate_series(
      date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    )::date as mo
  ),
  -- See the header: checkins_hourly under-records recent months by ~43% and
  -- inverted the trend. unique_checkins is now genuinely distinct members.
  checkin_floor as (
    select min(month) as first_month from public.abc_member_checkin_months
  ),
  checkins as (
    select c.month, sum(c.checkins) as total_checkins, count(distinct c.member_id) as unique_members
    from public.abc_member_checkin_months c
    where (p_clubs is null or c.club_number = any(p_clubs))
    group by 1
  )
  select
    mo as month_start,
    (
      select count(*) from mem
      where since_date <= (mo + interval '1 month - 1 day')::date
        and not (
          member_status in ('Cancelled', 'Expired', 'Return For Collection')
          and member_status_date <= (mo + interval '1 month - 1 day')::date
        )
    ) as total_members,
    (
      select count(*) from mem
      where since_date >= mo and since_date < mo + interval '1 month'
    ) as new_member_units,
    (
      select count(*) from mem
      where member_status in ('Cancelled', 'Expired', 'Return For Collection')
        and member_status_date >= mo
        and member_status_date < mo + interval '1 month'
    ) as lost_members,
    coalesce((select total_checkins from checkins where checkins.month = mo), 0) as total_checkins,
    coalesce((select unique_members from checkins where checkins.month = mo), 0) as unique_checkins,
    (
      select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
      where r.payment_date >= mo and r.payment_date < mo + interval '1 month'
        and (p_clubs is null or r.club_number = any(p_clubs))
    ) as total_revenue,
    (
      select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
      where r.payment_date >= mo and r.payment_date < mo + interval '1 month'
        and r.profit_center = 'TRAINING'
        and (p_clubs is null or r.club_number = any(p_clubs))
    ) as pt_revenue,
    (mo >= (select first_month from checkin_floor)) as has_checkin_data
  from months
  order by mo;
$$;

create or replace function public.analytics_topline(
  p_end     date,
  p_clubs   text[]  default null,
  p_exclude boolean default true
)
returns jsonb
language sql
stable
as $$
  with w(name, s, e) as (
    values
      ('mtd',           date_trunc('month', p_end)::date,                                p_end),
      ('prior_mtd',     date_trunc('month', p_end - interval '1 month')::date,            (p_end - interval '1 month')::date),
      ('py_mtd',        date_trunc('month', p_end - interval '1 year')::date,             (p_end - interval '1 year')::date),
      ('ytd',           date_trunc('year', p_end)::date,                                  p_end),
      ('py_ytd',        date_trunc('year', p_end - interval '1 year')::date,              (p_end - interval '1 year')::date),
      ('last30',        (p_end - interval '29 days')::date,                               p_end),
      ('py_last30',     (p_end - interval '1 year' - interval '29 days')::date,           (p_end - interval '1 year')::date),
      ('past3mo',       (p_end - interval '3 months' + interval '1 day')::date,           p_end),
      ('prior3mo',      (p_end - interval '6 months' + interval '1 day')::date,           (p_end - interval '3 months')::date),
      ('py_past3mo',    (p_end - interval '1 year' - interval '3 months' + interval '1 day')::date, (p_end - interval '1 year')::date)
  ),
  -- Whole-month check-ins; see the header for why this is not a 30-day window.
  --
  -- The CTE is NOT named `checkins`: it has a column of that name, and a bare
  -- to_jsonb(checkins) binds to the COLUMN, silently returning a number where
  -- the object was meant. That happened once and the card came back as 86229
  -- instead of an object.
  ci as (
    select
      m.this_month                                                                 as month,
      coalesce(sum(c.checkins) filter (where c.month = m.this_month), 0)::bigint    as checkins,
      count(distinct c.member_id) filter (where c.month = m.this_month)::bigint     as members_visited,
      coalesce(sum(c.checkins) filter (where c.month = m.prior_month), 0)::bigint   as prior_checkins,
      count(distinct c.member_id) filter (where c.month = m.prior_month)::bigint    as prior_members_visited
    from (
      select
        (date_trunc('month', p_end) - interval '1 month')::date                     as this_month,
        (date_trunc('month', p_end) - interval '1 month' - interval '1 year')::date as prior_month
    ) m
    left join public.abc_member_checkin_months c
      on c.month in (m.this_month, m.prior_month)
     and (p_clubs is null or c.club_number = any(p_clubs))
    group by m.this_month
  )
  select jsonb_build_object(
    'windows', (
      select jsonb_object_agg(
        w.name,
        to_jsonb(m) || jsonb_build_object('start', w.s, 'end', w.e)
      )
      from w, lateral public.analytics_topline_window(w.s, w.e, p_clubs, p_exclude) m
    ),
    'members', jsonb_build_object(
      'now',            public.analytics_topline_members_as_of(p_end, p_clubs, p_exclude),
      'prior_year',     public.analytics_topline_members_as_of((p_end - interval '1 year')::date, p_clubs, p_exclude),
      'start_of_year',  public.analytics_topline_members_as_of((date_trunc('year', p_end)::date - 1), p_clubs, p_exclude),
      'start_of_py',    public.analytics_topline_members_as_of((date_trunc('year', p_end - interval '1 year')::date - 1), p_clubs, p_exclude),
      'prior3mo_end',   public.analytics_topline_members_as_of((p_end - interval '3 months')::date, p_clubs, p_exclude)
    ),
    'checkins', (select to_jsonb(ci) from ci),
    'as_of', p_end
  );
$$;

comment on function public.analytics_club_activity is
  'Monthly series for Analytics > Club Activity Trends. Check-ins come from abc_member_checkin_months; checkins_hourly under-records recent months by ~43%.';

comment on function public.analytics_topline is
  'Window metrics for Analytics > Topline. Check-ins are a whole-month comparison from abc_member_checkin_months; checkins_hourly under-records recent months by ~43% and inverted the trend.';
