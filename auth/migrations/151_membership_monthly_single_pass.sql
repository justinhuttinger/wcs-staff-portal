-- 151_membership_monthly_single_pass.sql
--
-- Membership Snapshot was failing with "Could not load the report". The cause
-- was mine, in migration 149.
--
-- That version called analytics_topline_window once per month through a lateral
-- join. Each call rebuilt a CTE over all 95,482 members and, worse, re-evaluated
-- analytics_members_excluded_as_of to apply the conditional-membership rule —
-- a correlated NOT EXISTS that ran roughly 6,400 times PER MONTH. Thirteen
-- months of that measured 12,186 ms and blew the statement timeout. It was
-- never caught because the version I tested was four months, which came in
-- under the limit at around 3.7 s.
--
-- The lesson worth keeping: a per-month lateral over an already-expensive
-- function multiplies the expensive part by the number of months. The series
-- has to be one pass over the data with the months joined in, which is how
-- analytics_membership_trends has always done it — 13 months in 3.1 s.
--
-- Rewritten that way here. The definitions are unchanged and are asserted
-- against analytics_topline_window and analytics_topline_members_as_of after
-- this file is applied; if any month disagrees, this is wrong.
--
-- STOCK vs FLOW, restated because the rewrite has to preserve it:
--   New members are a flow IN and never take the conditional test.
--   Lost members are a flow OUT of the stock, so they DO take it — a member who
--   was never counted cannot also be counted as a loss.

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
    select
      m as mo,
      -- The newest month stops at p_end, so the current month is compared
      -- against the same day of earlier months rather than against whole ones.
      least((m + interval '1 month' - interval '1 day')::date, p_end) as mo_end
    from generate_series(
      date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    ) g(m)
  ),
  skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  -- Scanned ONCE for the whole series. This being inside the per-month call is
  -- what made the old version quadratic.
  mem as (
    select m.club_number, m.member_id, m.membership_type, m.since_date,
           m.member_status, m.member_status_date, m.next_due_amount
    from public.abc_members m
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (
        not p_exclude
        or lower(coalesce(m.membership_type, '')) not in (select t from skip)
      )
  ),
  -- The conditional-membership rule, evaluated for every month in one pass
  -- instead of once per month. Same predicate as
  -- analytics_members_excluded_as_of, including the new-member waiver: somebody
  -- who joined inside the window has not had the full window in which to visit,
  -- so failing the check-in test means nothing.
  excluded as (
    select mo.mo, m.club_number, m.member_id
    from mem m
    join public.abc_conditional_membership_types c
      on c.membership_type = m.membership_type
    cross join months mo
    where p_exclude
      and not (
        m.since_date is not null
        and m.since_date >= public.analytics_conditional_window_start(mo.mo_end, c.active_within_months)
      )
      and not exists (
        select 1
        from public.abc_member_checkin_months k
        where k.club_number = m.club_number
          and k.member_id = m.member_id
          and k.checkins > 0
          and k.month >= public.analytics_conditional_window_start(mo.mo_end, c.active_within_months)
          and k.month <= date_trunc('month', mo.mo_end)::date
      )
  ),
  -- Stock at each month end: joined by then, not gone by then, and not excluded.
  stock as (
    select mo.mo, count(*) as n
    from mem m
    cross join months mo
    where m.since_date <= mo.mo_end
      and (
        m.member_status is distinct from any (array['Cancelled', 'Expired', 'Return For Collection'])
        or m.member_status_date > mo.mo_end
      )
      and not exists (
        select 1 from excluded e
        where e.mo = mo.mo and e.club_number = m.club_number and e.member_id = m.member_id
      )
    group by mo.mo
  ),
  joined as (
    select mo.mo, count(*) as n, coalesce(sum(m.next_due_amount), 0) as dues
    from mem m
    cross join months mo
    where m.since_date between mo.mo and mo.mo_end
    group by mo.mo
  ),
  lost as (
    select mo.mo, count(*) as n
    from mem m
    cross join months mo
    where m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
      and m.member_status_date between mo.mo and mo.mo_end
      and not exists (
        select 1 from excluded e
        where e.mo = mo.mo and e.club_number = m.club_number and e.member_id = m.member_id
      )
    group by mo.mo
  ),
  money as (
    select mo.mo,
           coalesce(sum(r.payment_amount), 0) as revenue,
           coalesce(sum(r.payment_amount) filter (where r.profit_center = 'TRAINING'), 0) as pt
    from months mo
    left join public.abc_revenue_transactions r
      on r.payment_date between mo.mo and mo.mo_end
      and (p_clubs is null or r.club_number = any(p_clubs))
    group by mo.mo
  ),
  visits as (
    select mo.mo, coalesce(sum(c.total_checkins), 0) as n
    from months mo
    left join public.checkins_hourly c
      on c.hour_start >= mo.mo
      and c.hour_start < (mo.mo_end + 1)
      and (p_clubs is null or c.club_number = any(p_clubs))
    group by mo.mo
  ),
  first_checkin as (select min(hour_start)::date as d from public.checkins_hourly)
  select
    mo.mo,
    coalesce(stock.n, 0),
    coalesce(joined.n, 0),
    coalesce(lost.n, 0),
    coalesce(joined.n, 0) - coalesce(lost.n, 0),
    coalesce(joined.dues, 0),
    coalesce(money.revenue, 0),
    coalesce(money.pt, 0),
    coalesce(visits.n, 0),
    (mo.mo >= (select d from first_checkin))
  from months mo
  left join stock  on stock.mo  = mo.mo
  left join joined on joined.mo = mo.mo
  left join lost   on lost.mo   = mo.mo
  left join money  on money.mo  = mo.mo
  left join visits on visits.mo = mo.mo
  order by mo.mo
$$;
