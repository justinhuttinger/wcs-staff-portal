-- 146: Day One outcomes for the Trainer Snapshot, and a rename that matters.
--
-- TRAINERS SERVICE DAY ONES, THEY DO NOT BOOK THEM. The counts here were
-- already keyed on day_one_appointments.trainer_name -- who ran the intro --
-- but the column was called day_ones_booked, which credited trainers with the
-- front desk's work every time somebody read the label. It is day_ones now.
--
-- The status breakdown is new: completed, sold, cancelled and no-showed, so the
-- report can show what became of the intros a trainer was given rather than
-- only how many landed in their diary. day_one_appointments carries exactly
-- four statuses -- scheduled, completed, cancelled, no_show -- and outcome is
-- Sale or No Sale on the completed ones.
--
-- Verified: Donovan Rust, August 2026 -- 38 Day Ones, 16 completed, 1 sold,
-- 3 cancelled, 6 no-showed.

-- The return type gains two columns and renames one, so the old signature has
-- to go first; CREATE OR REPLACE cannot change a function's OUT columns.
drop function if exists public.analytics_trainer_monthly(date, integer, text[], text);

create or replace function public.analytics_trainer_monthly(
  p_end     date,
  p_months  integer default 13,
  p_clubs   text[] default null,
  p_person  text   default null
)
returns table (
  month_start         date,
  completed_sessions  bigint,
  cancelled_sessions  bigint,
  unique_clients      bigint,
  pt_minutes          bigint,
  day_ones            bigint,
  day_ones_completed  bigint,
  day_ones_sold       bigint,
  day_ones_cancelled  bigint,
  day_ones_no_show    bigint,
  close_amount        numeric
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
  -- An empty key means "everyone", which is what the roster falls back to.
  key as (select lower(regexp_replace(trim(coalesce(p_person, '')), '\s+', ' ', 'g')) as k),
  ev as (
    select date_trunc('month', e.event_timestamp_local)::date as mo,
           count(*) filter (where e.status = 'Completed') as completed,
           -- status is the signal, not attended_status: ABC leaves that at
           -- 'Did Not Attend' on 73% of completed appointments.
           count(*) filter (where e.status like 'Canceled%') as cancelled,
           count(distinct e.member_id) filter (where e.status = 'Completed' and e.member_id is not null) as clients,
           coalesce(sum(e.duration_minutes) filter (where e.status = 'Completed' and e.category = 'Appointment'), 0) as pt_minutes
    from public.abc_calendar_events e, key
    where e.employee_first_name is not null
      and (p_clubs is null or e.club_number = any(p_clubs))
      and (key.k = '' or lower(regexp_replace(trim(e.employee_first_name || ' ' || e.employee_last_name), '\s+', ' ', 'g')) = key.k)
    group by 1
  ),
  -- Keyed on trainer_name, who RAN the intro -- never booked_by_name, who put
  -- it in the diary.
  d1 as (
    select date_trunc('month', a.booked_at)::date as mo,
           count(*) as given,
           count(*) filter (where a.status = 'completed') as completed,
           count(*) filter (where a.status = 'completed' and a.outcome = 'Sale') as sold,
           count(*) filter (where a.status = 'cancelled') as cancelled,
           count(*) filter (where a.status = 'no_show') as no_show
    from public.day_one_appointments a
    join clubmap c on c.slug = a.location_slug, key
    where (p_clubs is null or c.club_number = any(p_clubs))
      and (key.k = '' or lower(regexp_replace(trim(coalesce(a.trainer_name, '')), '\s+', ' ', 'g')) = key.k)
    group by 1
  ),
  -- Money follows the commission employee; see migration 144.
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
         coalesce(d1.given, 0), coalesce(d1.completed, 0), coalesce(d1.sold, 0),
         coalesce(d1.cancelled, 0), coalesce(d1.no_show, 0),
         coalesce(svc.amount, 0)
  from months
  left join ev  on ev.mo = months.mo
  left join d1  on d1.mo = months.mo
  left join svc on svc.mo = months.mo
  order by 1;
$function$;
