-- 134: count a prepaid PT package for as long as it actually lasts.
--
-- THE PROBLEM
--
-- ABC marks a Paid In Full package inactive at the moment of sale and records
-- no end date. Verified against all 367 PIF rows: inactive_date, total_periods,
-- number_billed and next_billing_date are null on every single one. Only
-- sale_date, invoice_total and unit_price carry anything.
--
-- So the feed cannot say when a package runs out, and PT Penetration counted
-- every PIF buyer for a flat 3 months — the same 3 months whether they bought
-- one session or twenty-four.
--
-- WHAT RECOVERS A REAL ANSWER
--
-- 1. Sessions purchased = invoice_total / unit_price. This divides cleanly into
--    the package sizes actually sold, which is what shows it is the real
--    session count rather than an artefact of two unrelated numbers:
--
--      sessions  1   2   4   5   6   8  10  12  15  20  24
--      packages 43  18  47  67   9  13  74   8   4  60   6
--
-- 2. Consumption rate = 5.3 sessions per 30 days. Measured from
--    abc_calendar_events across PIF packages sold since 2026-01-15 (the events
--    feed begins 2026-01-01, so earlier sales would look artificially idle):
--    242 packages, of which 157 trained, averaging 8.45 sessions over 61 days.
--
-- A package therefore lasts sessions / 5.3 months. The average 7.9-session
-- package runs about 1.5 months rather than 3; a 24-session package runs about
-- 4.5. Capped at 12, because nobody is still working through a package a year
-- later, and floored at 1 so a single-session package still counts in the month
-- it was bought.
--
-- WHY THE SESSION EVENTS ARE NOT USED DIRECTLY
--
-- They would be the exact answer — count a member as a PT client until their
-- sessions run out — but abc_calendar_events only reaches back to 2026-01 while
-- this chart runs about 24 months. Driving the window from it would put a step
-- in the line at the coverage boundary that reflects where the feed starts
-- rather than anything that happened, which is the same trap migration 132
-- avoided for the conditional membership rule. Calibrating a rate on the window
-- where truth exists and applying it across the whole history keeps every month
-- measured the same way.
--
-- p_pif_months stays as the fallback for the 3 rows with no usable price.
--
-- EFFECT (all clubs, Exclude):
--
--   month     PIF before -> after    penetration before -> after
--   2026-06        81   ->   64          2.75%  ->  2.67%
--   2026-07       112   ->   85          2.99%  ->  2.86%
--   2026-08       125   ->   81          2.94%  ->  2.70%

create or replace function public.analytics_pt_penetration_v2(
  p_end        date,
  p_months     integer default 32,
  p_clubs      text[]  default null,
  p_pif_months integer default 3,
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
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  mem as (
    select m.club_number, m.member_id, m.membership_type, m.since_date,
           m.member_status, m.member_status_date
    from public.abc_members m
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(m.membership_type, '')) not in (select t from skip))
  ),
  -- The series starts at the first month the conditional rule can answer; see
  -- migration 132.
  months as (
    select
      mo::date,
      (mo + interval '1 month - 1 day')::date as mo_end
    from generate_series(
      (
        select case
          when p_exclude then greatest(
            date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
            min(k.month) + interval '2 months'
          )
          else date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval
        end
        from public.abc_member_checkin_months k
      ),
      date_trunc('month', p_end)::date,
      '1 month'
    ) as g(mo)
  ),
  clubs as (select distinct club_number from mem),
  cond as (
    select m.club_number, m.member_id, m.since_date, c.active_within_days
    from mem m
    join public.abc_conditional_membership_types c
      on c.membership_type = m.membership_type
  ),
  live as (
    select distinct mo.mo, k.club_number, k.member_id
    from months mo
    join public.abc_member_checkin_months k
      on k.checkins > 0
     and k.month >= date_trunc('month', mo.mo_end - 60)::date
     and k.month <= mo.mo
  ),
  dead as (
    select mo.mo, c.club_number, c.member_id
    from months mo
    cross join cond c
    where not (c.since_date is not null and c.since_date > (mo.mo_end - c.active_within_days))
      and not exists (
        select 1 from live l
        where l.mo = mo.mo and l.club_number = c.club_number and l.member_id = c.member_id
      )
  ),
  -- Per-package duration; see the header for how both numbers were derived.
  svc as (
    select s.*,
           (s.recurring_type_desc ilike '%paid in full%') as is_pif,
           case
             when s.invoice_total > 0 and s.unit_price > 0 then
               least(
                 greatest(ceil(round(s.invoice_total / s.unit_price) / 5.3), 1),
                 12
               )::int
             else p_pif_months
           end as pif_months
    from public.abc_pt_services s
    where (p_clubs is null or s.club_number = any(p_clubs))
      and s.sale_date is not null
  ),
  base as (
    select months.mo, mem.club_number, count(*) as members
    from months
    join mem
      on mem.since_date <= months.mo_end
     and not (
       mem.member_status in ('Cancelled', 'Expired', 'Return For Collection')
       and mem.member_status_date <= months.mo_end
     )
    left join dead d
      on p_exclude and d.mo = months.mo
     and d.club_number = mem.club_number and d.member_id = mem.member_id
    where d.member_id is null
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
      on svc.sale_date <= months.mo_end
     and (
       (not svc.is_pif and (svc.inactive_date is null or svc.inactive_date >= months.mo))
       or
       -- Per-package now, not a flat p_pif_months for everyone.
       (svc.is_pif and svc.sale_date >= (months.mo - ((svc.pif_months - 1) || ' months')::interval))
     )
    left join dead d
      on p_exclude and d.mo = months.mo
     and d.club_number = svc.club_number and d.member_id = svc.member_id
    where d.member_id is null
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
$function$;
