-- 145: month-by-month series for the Snapshot reports.
--
-- The Snapshot reports reuse the existing Salesperson and Trainer reports for
-- their headline numbers -- buildReport and buildTrainerPerformance -- so a
-- snapshot and the table it drills into can never disagree. These two functions
-- exist only for the trend chart, which needs MANY MONTHS OF ONE PERSON rather
-- than one month of many people, and neither existing report can answer that.
--
-- p_person is matched on a normalised name (collapsed whitespace, lowercased),
-- the same key the reports themselves join on. Passing null or an empty string
-- returns the whole club, which is what the roster picker falls back to.
--
-- Verified: Katie Castlio reads 64/52/47/65/35 new members across Apr-Aug 2026,
-- and Tom Anderson 178/175/165/171/126 sessions over the same months.

-- Membership: what one salesperson signed, month by month.
--
-- Counted on since_date, the day the MEMBERSHIP started -- never sign_date,
-- which moves onto the latest agreement and would both double-count re-signs
-- and lose the original sale. Same rule as Salesperson Performance.
create or replace function public.analytics_salesperson_monthly(
  p_end     date,
  p_months  integer default 13,
  p_clubs   text[] default null,
  p_person  text   default null
)
returns table (
  month_start        date,
  new_members        bigint,
  day_ones_booked    bigint,
  day_ones_completed bigint,
  day_ones_sold      bigint
)
language sql
stable
as $function$
  with clubmap(club_number, slug) as (values
    ('30935','salem'),('31599','keizer'),('7655','eugene'),('31598','springfield'),
    ('31600','clackamas'),('31601','milwaukie'),('32073','medford')
  ),
  skip as (select lower(membership_type) as t from public.abc_membership_skip_list),
  months as (
    select mo::date
    from generate_series(
      date_trunc('month', p_end)::date - ((greatest(p_months, 1) - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    ) as g(mo)
  ),
  -- An empty key means "everyone", which is what the picker falls back to
  -- before a person has been chosen.
  key as (select lower(regexp_replace(trim(coalesce(p_person, '')), '\s+', ' ', 'g')) as k),
  mem as (
    select date_trunc('month', m.since_date)::date as mo, count(*) as n
    from public.abc_members m, key
    where m.since_date is not null
      and (p_clubs is null or m.club_number = any(p_clubs))
      and lower(coalesce(m.membership_type, '')) not in (select t from skip)
      and (key.k = '' or lower(regexp_replace(trim(coalesce(m.sales_person_name, '')), '\s+', ' ', 'g')) = key.k)
    group by 1
  ),
  d1 as (
    select date_trunc('month', a.booked_at)::date as mo,
           count(*) as booked,
           count(*) filter (where a.status = 'completed') as completed,
           count(*) filter (where a.status = 'completed' and a.outcome = 'Sale') as sold
    from public.day_one_appointments a
    join clubmap c on c.slug = a.location_slug, key
    where (p_clubs is null or c.club_number = any(p_clubs))
      and (key.k = '' or lower(regexp_replace(trim(coalesce(a.booked_by_name, '')), '\s+', ' ', 'g')) = key.k)
    group by 1
  )
  select months.mo,
         coalesce(mem.n, 0),
         coalesce(d1.booked, 0),
         coalesce(d1.completed, 0),
         coalesce(d1.sold, 0)
  from months
  left join mem on mem.mo = months.mo
  left join d1  on d1.mo = months.mo
  order by 1;
$function$;

-- Training: what one trainer delivered and closed, month by month.
--
-- Carries the same attribution split as Trainer Performance (migration 144):
-- sessions and clients follow whoever DELIVERED them, close amount follows
-- whoever the COMMISSION was paid to, falling back to the deliverer only where
-- payroll holds no row for that sale.
create or replace function public.analytics_trainer_monthly(
  p_end     date,
  p_months  integer default 13,
  p_clubs   text[] default null,
  p_person  text   default null
)
returns table (
  month_start        date,
  completed_sessions bigint,
  cancelled_sessions bigint,
  unique_clients     bigint,
  pt_minutes         bigint,
  day_ones_booked    bigint,
  day_ones_completed bigint,
  day_ones_sold      bigint,
  close_amount       numeric
)
language sql
stable
as $function$
  with clubmap(club_number, slug) as (values
    ('30935','salem'),('31599','keizer'),('7655','eugene'),('31598','springfield'),
    ('31600','clackamas'),('31601','milwaukie'),('32073','medford')
  ),
  months as (
    select mo::date
    from generate_series(
      date_trunc('month', p_end)::date - ((greatest(p_months, 1) - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    ) as g(mo)
  ),
  key as (select lower(regexp_replace(trim(coalesce(p_person, '')), '\s+', ' ', 'g')) as k),
  ev as (
    select date_trunc('month', e.event_timestamp_local)::date as mo,
           count(*) filter (where e.status = 'Completed') as completed,
           -- Canceled-Charge is the only cancelled state ABC records here, and
           -- status is the signal: attended_status sits at 'Did Not Attend' on
           -- 73% of completed appointments and means nothing.
           count(*) filter (where e.status like 'Canceled%') as cancelled,
           count(distinct e.member_id) filter (where e.status = 'Completed' and e.member_id is not null) as clients,
           coalesce(sum(e.duration_minutes) filter (where e.status = 'Completed' and e.category = 'Appointment'), 0) as pt_minutes
    from public.abc_calendar_events e, key
    where e.employee_first_name is not null
      and (p_clubs is null or e.club_number = any(p_clubs))
      and (key.k = '' or lower(regexp_replace(trim(e.employee_first_name || ' ' || e.employee_last_name), '\s+', ' ', 'g')) = key.k)
    group by 1
  ),
  d1 as (
    select date_trunc('month', a.booked_at)::date as mo,
           count(*) as booked,
           count(*) filter (where a.status = 'completed') as completed,
           count(*) filter (where a.status = 'completed' and a.outcome = 'Sale') as sold
    from public.day_one_appointments a
    join clubmap c on c.slug = a.location_slug, key
    where (p_clubs is null or c.club_number = any(p_clubs))
      and (key.k = '' or lower(regexp_replace(trim(coalesce(a.trainer_name, '')), '\s+', ' ', 'g')) = key.k)
    group by 1
  ),
  svc as (
    select date_trunc('month', s.sale_date)::date as mo,
           coalesce(sum(s.invoice_total), 0) as amount
    from public.abc_pt_services s
    left join public.payroll_recurring_commissions p
      on p.recurring_service_id = s.recurring_service_id, key
    where s.sale_date is not null
      and (p_clubs is null or s.club_number = any(p_clubs))
      and (key.k = '' or lower(regexp_replace(trim(coalesce(p.employee_name, s.trainer_name, '')), '\s+', ' ', 'g')) = key.k)
    group by 1
  )
  select months.mo,
         coalesce(ev.completed, 0), coalesce(ev.cancelled, 0),
         coalesce(ev.clients, 0), coalesce(ev.pt_minutes, 0),
         coalesce(d1.booked, 0), coalesce(d1.completed, 0), coalesce(d1.sold, 0),
         coalesce(svc.amount, 0)
  from months
  left join ev  on ev.mo = months.mo
  left join d1  on d1.mo = months.mo
  left join svc on svc.mo = months.mo
  order by 1;
$function$;
