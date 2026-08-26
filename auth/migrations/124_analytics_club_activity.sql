-- Monthly series behind Analytics > Club Activity Trends.
--
-- One row per month with every metric the report charts. Done in SQL rather
-- than by pulling rows into the API because the window is 25 months (13 shown
-- plus 12 more to compare each against a year earlier) across ~101k members
-- and ~540k revenue transactions.
--
-- Definitions worth knowing before reading the numbers:
--
--  new_member_units  Counted on since_date, the member's ORIGINAL join date,
--                    NOT sign_date. sign_date moves: abc_members holds one row
--                    per member carrying their CURRENT agreement, so when
--                    someone re-signs, their sign_date jumps to the new date
--                    and they vanish from the month they actually joined.
--                    Measured on sign_date, August 2025 reads 382; on
--                    since_date it reads 461, and the external tool we are
--                    rebuilding reports 466. On a year-over-year chart the
--                    sign_date basis does not just shift the number, it flips
--                    the sign of the trend.
--
--  total_members     Reconstructed as of each month end: joined on or before
--                    that date and not already lost by it. abc_members keeps
--                    only the LATEST status change, so a member who cancelled,
--                    rejoined and cancelled again is counted from their single
--                    surviving status row. Tracks the external tool closely
--                    (July 2026: 19,683 here vs 18,960 there, the gap being
--                    its adults-only unit definition).
--
--  lost_members      Cancelled / Expired / Return For Collection, dated by
--                    member_status_date.
--
--  unique_checkins   checkins_hourly counts unique members PER HOUR, so a
--                    member who visits twice in a day is counted twice. It is
--                    the closest thing we hold to "unique daily check-ins" and
--                    lands within ~3% of the external tool's YTD figure.
--                    Coverage starts 2025-05-06 — there is no prior-year
--                    comparison before then, and the API returns null rather
--                    than zero for those months.
--
-- The membership skip list (abc_membership_skip_list) gates the three member
-- counts, matching the Salesperson Performance report. Revenue and check-ins
-- are not per-member-type and cannot be filtered by it.

create or replace function public.analytics_club_activity(
  p_end     date,
  p_months  int     default 25,
  p_clubs   text[]  default null,
  p_exclude boolean default true
)
returns table (
  month_start        date,
  total_members      bigint,
  new_member_units   bigint,
  lost_members       bigint,
  total_checkins     bigint,
  unique_checkins    bigint,
  total_revenue      numeric,
  pt_revenue         numeric,
  has_checkin_data   boolean
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
  -- Earliest hour we hold check-ins for, so months before it report null
  -- instead of a zero that would read as "nobody came in".
  checkin_floor as (
    select date_trunc('month', min(hour_start))::date as first_month
    from public.checkins_hourly
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
    (
      select coalesce(sum(c.total_checkins), 0) from public.checkins_hourly c
      where c.hour_start >= mo and c.hour_start < mo + interval '1 month'
        and (p_clubs is null or c.club_number = any(p_clubs))
    ) as total_checkins,
    (
      select coalesce(sum(c.unique_members), 0) from public.checkins_hourly c
      where c.hour_start >= mo and c.hour_start < mo + interval '1 month'
        and (p_clubs is null or c.club_number = any(p_clubs))
    ) as unique_checkins,
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

comment on function public.analytics_club_activity is
  'Monthly series for Analytics > Club Activity Trends. new_member_units counts since_date (original join), never sign_date, which moves when a member re-signs.';

-- The report scans these three columns by date across the whole table.
create index if not exists idx_abc_members_since_status
  on public.abc_members (since_date, member_status_date);

create index if not exists idx_abc_revenue_payment_date
  on public.abc_revenue_transactions (payment_date, club_number);

create index if not exists idx_abc_revenue_profit_center
  on public.abc_revenue_transactions (profit_center, payment_date);

create index if not exists idx_checkins_hourly_hour
  on public.checkins_hourly (hour_start, club_number);
