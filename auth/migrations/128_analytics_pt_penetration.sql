-- Monthly PT penetration by club, behind Analytics > PT Penetration.
--
-- WHY THIS IS BUILT ON REVENUE
--
-- ABC gives us no PT agreement history. abc_recurring_pt_services holds ~300
-- rows describing currently ACTIVE recurring services, with no start dates and
-- no paid-in-full rows, so it cannot answer "who was a PT client in March
-- 2025". Training revenue can, and goes back to 2024-01-01.
--
-- WHAT COUNTS AS PT
--
-- profit_center = 'TRAINING', minus two catalog items that are not personal
-- training and would wreck the number:
--   PT CONSULT   the free consultation — ~1,900 members a year at $0. Counting
--                it treats everyone offered a Day One as a PT client and
--                roughly quadruples penetration.
--   INBODY SCAN  a body composition scan.
--
-- REFUNDS
--
-- Kept for revenue, excluded from the member count. July 2026 alone carries 59
-- refund rows worth -$41,551; dropping them reported $200k of PT revenue
-- against an actual $158k, while counting a refund as a purchase would make a
-- departing client look like a new one.
--
-- THE WINDOW
--
-- A PT member paid within p_window_months, not necessarily in the month itself.
-- A prepaid block covers months of sessions in one transaction, so a strict
-- one-month test drops those clients for every month but the one they bought
-- in. It changes the answer materially — July 2026 reads 1.97% at one month
-- and 3.26% at three — so it is a setting, defaulted to three.
--
-- Written set-based rather than as correlated subqueries per (month, club):
-- the correlated form ran 224 cells each scanning the whole member table and
-- hit the statement timeout. This returns in about 2 seconds.

create or replace function public.analytics_pt_penetration(
  p_end            date,
  p_months         int     default 32,
  p_clubs          text[]  default null,
  p_window_months  int     default 3,
  p_exclude        boolean default true
)
returns table (
  month_start date,
  club_number text,
  members     bigint,
  pt_members  bigint,
  pt_revenue  numeric
)
language sql
stable
as $$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  mem as (
    select m.club_number, m.since_date, m.member_status, m.member_status_date
    from public.abc_members m
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(m.membership_type, '')) not in (select t from skip))
  ),
  months as (
    select generate_series(
      date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    )::date as mo
  ),
  clubs as (select distinct club_number from mem),
  pt_txn as (
    select
      ltrim(r.club_number, '0') as club_key,
      r.member_number,
      r.payment_date,
      r.payment_amount
    from public.abc_revenue_transactions r
    where r.profit_center = 'TRAINING'
      and upper(coalesce(r.catalog_item, '')) not in ('PT CONSULT', 'INBODY SCAN')
      and r.payment_date >= (
        date_trunc('month', p_end)::date
        - ((p_months - 1) || ' months')::interval
        - ((p_window_months - 1) || ' months')::interval
      )
      and r.payment_date <= p_end
  ),
  base as (
    select months.mo, mem.club_number, count(*) as members
    from months
    join mem
      on mem.since_date <= (months.mo + interval '1 month - 1 day')::date
     and not (
       mem.member_status in ('Cancelled', 'Expired', 'Return For Collection')
       and mem.member_status_date <= (months.mo + interval '1 month - 1 day')::date
     )
    group by 1, 2
  ),
  pt as (
    select months.mo, t.club_key, count(distinct t.member_number) as pt_members
    from months
    join pt_txn t
      on t.payment_amount > 0
     and t.payment_date >= (months.mo - ((p_window_months - 1) || ' months')::interval)
     and t.payment_date < months.mo + interval '1 month'
    group by 1, 2
  ),
  rev as (
    select date_trunc('month', t.payment_date)::date as mo,
           t.club_key,
           sum(t.payment_amount) as pt_revenue
    from pt_txn t
    group by 1, 2
  )
  select
    months.mo as month_start,
    clubs.club_number,
    coalesce(base.members, 0) as members,
    coalesce(pt.pt_members, 0) as pt_members,
    coalesce(rev.pt_revenue, 0) as pt_revenue
  from months
  cross join clubs
  left join base on base.mo = months.mo and base.club_number = clubs.club_number
  left join pt   on pt.mo = months.mo   and pt.club_key = ltrim(clubs.club_number, '0')
  left join rev  on rev.mo = months.mo  and rev.club_key = ltrim(clubs.club_number, '0')
  order by 1, 2;
$$;

comment on function public.analytics_pt_penetration is
  'Monthly PT penetration by club. A PT member paid >0 for training within p_window_months; revenue is NET of refunds. PT CONSULT and INBODY SCAN excluded.';

create index if not exists idx_abc_revenue_training
  on public.abc_revenue_transactions (profit_center, payment_date)
  where profit_center = 'TRAINING';
