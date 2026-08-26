-- Member-level PT service history, so PT penetration can be counted properly.
--
-- WHY THIS REPLACES THE REVENUE-BASED APPROACH (migration 128)
--
-- The first version inferred PT clients from training revenue, because
-- abc_recurring_pt_services holds only ~300 currently-active rows with no
-- dates. That had two flaws:
--
--   1. abc_revenue_transactions.member_number is the AGREEMENT number despite
--      its name, so the count was of agreements while the denominator counted
--      people. Not a valid rate — it read 3.27% where the unit-consistent
--      figure was 3.88%.
--   2. "Paid in the last N months" was a proxy for "was a client", with the
--      window a setting because the proxy was ambiguous.
--
-- ABC's /members/recurringservices carries a real memberId plus saleDate and
-- inactiveDate, which answers both exactly. This table stores that history.
--
-- PIF IS DIFFERENT, AND THE DIFFERENCE IS NOT FIXABLE HERE
--
-- Every Paid in Full service comes back status=inactive with NO inactiveDate
-- and numberBilled 0/0: it is marked inactive at the moment of sale because
-- there is nothing recurring left to bill. So ABC tells us when a PIF package
-- was SOLD and nothing about how long the client kept training on it.
--
-- Recurring services (Fixed Interval, Open Monthly) therefore give an exact
-- month-by-month answer, and PIF can only be estimated by counting a client
-- for a chosen number of months after the sale. The report keeps the two
-- apart rather than blending an exact number into an estimated one.

create table if not exists public.abc_pt_services (
  recurring_service_id text primary key,
  club_number          text not null,
  member_id            text not null,
  member_name          text,
  agreement_number     text,
  service_item         text,
  recurring_type_desc  text,
  status               text,
  sub_status           text,
  sale_date            date,
  first_billing_date   date,
  next_billing_date    date,
  inactive_date        date,
  deactivate_reason    text,
  invoice_total        numeric,
  unit_price           numeric,
  number_billed        integer,
  total_periods        integer,
  frequency            text,
  sales_person_id      text,
  sales_person_name    text,
  trainer_id           text,
  trainer_name         text,
  campaign_name        text,
  purchased_club       text,
  synced_at            timestamptz not null default now()
);

comment on table public.abc_pt_services is
  'PT recurring services from ABC /members/recurringservices, keyed by member_id (a real member, unlike revenue.member_number which is an agreement). Paid in Full rows carry a sale_date but never an inactive_date.';

create index if not exists idx_pt_services_club_sale
  on public.abc_pt_services (club_number, sale_date);
create index if not exists idx_pt_services_member
  on public.abc_pt_services (member_id, sale_date desc);
create index if not exists idx_pt_services_window
  on public.abc_pt_services (sale_date, inactive_date);

alter table public.abc_pt_services enable row level security;

-- Monthly PT penetration by club, counting MEMBERS.
--
--   recurring   exact: the service was sold on or before the month end and had
--               not gone inactive before the month started
--   pif         estimated: counted for p_pif_months after the sale, because
--               ABC records no end date for a prepaid package
--   pt_members  the two deduplicated, since one person can hold both
create or replace function public.analytics_pt_penetration_v2(
  p_end        date,
  p_months     int     default 32,
  p_clubs      text[]  default null,
  p_pif_months int     default 3,
  p_exclude    boolean default true
)
returns table (
  month_start          date,
  club_number          text,
  members              bigint,
  pt_members           bigint,
  recurring_pt_members bigint,
  pif_pt_members       bigint
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
  svc as (
    select s.*,
           (s.recurring_type_desc ilike '%paid in full%') as is_pif
    from public.abc_pt_services s
    where (p_clubs is null or s.club_number = any(p_clubs))
      and s.sale_date is not null
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
  active as (
    select
      months.mo,
      svc.club_number,
      svc.member_id,
      bool_or(not svc.is_pif) as has_recurring,
      bool_or(svc.is_pif)     as has_pif
    from months
    join svc
      on svc.sale_date <= (months.mo + interval '1 month - 1 day')::date
     and (
       (not svc.is_pif and (svc.inactive_date is null or svc.inactive_date >= months.mo))
       or
       (svc.is_pif and svc.sale_date >= (months.mo - ((p_pif_months - 1) || ' months')::interval))
     )
    group by 1, 2, 3
  ),
  agg as (
    select mo, club_number,
           count(*) as pt_members,
           count(*) filter (where has_recurring) as recurring_pt_members,
           count(*) filter (where has_pif) as pif_pt_members
    from active
    group by 1, 2
  )
  select
    months.mo as month_start,
    clubs.club_number,
    coalesce(base.members, 0),
    coalesce(agg.pt_members, 0),
    coalesce(agg.recurring_pt_members, 0),
    coalesce(agg.pif_pt_members, 0)
  from months
  cross join clubs
  left join base on base.mo = months.mo and base.club_number = clubs.club_number
  left join agg  on agg.mo = months.mo  and agg.club_number = clubs.club_number
  order by 1, 2;
$$;

comment on function public.analytics_pt_penetration_v2 is
  'Monthly PT penetration counting MEMBERS from abc_pt_services. Recurring is exact from sale/inactive dates; PIF is estimated over p_pif_months after sale because ABC records no end date.';
