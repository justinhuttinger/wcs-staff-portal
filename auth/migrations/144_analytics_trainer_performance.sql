-- 144: Trainer Performance.
--
-- What each trainer delivered, and what they closed.
--
-- THREE SOURCES, JOINED ON NAME, because nothing shares an id:
--
--   abc_calendar_events   sessions delivered   (keyed by ABC employee id)
--   day_one_appointments  intros and outcome   (keyed by GHL user id)
--   abc_pt_services       PT sold              (trainer_name only, no id)
--
-- So the join key is a normalised name, and it is not perfect: 30 of 42 Day One
-- trainers also appear in the calendar. The other 12 are managers who run
-- intros and deliver no sessions — Ryan Harris alone has 151 Day Ones — which
-- is why this is a UNION of names with left joins rather than an inner join.
-- A manager with intros and no sessions is a real row, and so is a trainer who
-- delivers and never sells. An inner join would have silently deleted both.
--
-- trainer_name was chosen over sales_person_name for the money: it matches 35
-- of 42 Day One trainers against 19, and is populated on every PT service row.
--
-- MONEY FOLLOWS THE COMMISSION EMPLOYEE; CLIENTS FOLLOW THE SERVICE EMPLOYEE.
--
-- abc_pt_services.trainer_name is ABC's serviceEmployee — who DELIVERS the
-- training. Who gets PAID for selling it is a different field entirely,
-- commissionsEmployeeIds, which that sync never captured. It is resolved in
-- payroll_recurring_commissions.employee_name, on the same
-- recurring_service_id, by the same logic the payroll run uses.
--
-- The two disagree far more often than not: for July 2026, 48 of 116 sales
-- carry a different commission employee, moving $20,605 of $51,781 — 40% of the
-- month. Crediting the deliverer would have been wrong for two fifths of the
-- money, and it is the difference between a trainer report and a payroll
-- report disagreeing every single month.
--
-- Sessions and members need no such indirection: abc_calendar_events already
-- records who actually ran each session.
--
-- payroll_recurring_commissions is loaded BY HAND each month and reaches back
-- only to 2026-04-01. Before that the deliverer is the only name on file, so
-- those rows are flagged close_amount_estimated and the report marks them
-- rather than implying a precision it does not have.
--
-- STATUS IS THE ATTENDANCE SIGNAL, NOT attended_status.
--
-- ABC leaves attended_status at 'Did Not Attend' on 12,337 of 16,831 completed
-- appointments — 73%. That is a default, not 73% of members no-showing. Reading
-- it literally would gut every count in this report.
--
-- WHAT IS DELIBERATELY ABSENT
--
--   Employee Start Date     abc_employees carries no hire date. An empty
--                           column is worse than no column.
--   Available Hours         not asked for.
--   Utilization Rate        not asked for, and uncomputable without the above.

-- The return type gains close_amount_estimated, so the old signature has to
-- go first; CREATE OR REPLACE cannot change a function's OUT columns.
drop function if exists public.analytics_trainer_performance(date, date, text[]);

create or replace function public.analytics_trainer_performance(
  p_start date,
  p_end   date,
  p_clubs text[] default null
)
returns table (
  trainer            text,
  club_number        text,
  last_session       date,
  unique_members     bigint,
  completed_sessions bigint,
  cancelled_sessions bigint,
  session_minutes    bigint,
  pt_minutes         bigint,
  class_minutes      bigint,
  member_months      numeric,
  day_ones_booked    bigint,
  day_ones_completed bigint,
  day_ones_sold      bigint,
  close_amount       numeric,
  close_amount_estimated boolean
)
language sql
stable
as $function$
  with clubmap(club_number, slug) as (values
    ('30935','salem'),('31599','keizer'),('7655','eugene'),('31598','springfield'),
    ('31600','clackamas'),('31601','milwaukie'),('32073','medford')
  ),
  ev as (
    select
      lower(regexp_replace(trim(e.employee_first_name || ' ' || e.employee_last_name), '\s+', ' ', 'g')) as k,
      trim(regexp_replace(e.employee_first_name || ' ' || e.employee_last_name, '\s+', ' ', 'g')) as raw,
      e.club_number, e.member_id, e.event_timestamp_local::date as d,
      e.status, e.category, coalesce(e.duration_minutes, 0) as mins
    from public.abc_calendar_events e
    where e.employee_first_name is not null
      and e.event_timestamp_local::date between p_start and p_end
      and (p_clubs is null or e.club_number = any(p_clubs))
  ),
  d1 as (
    select
      lower(regexp_replace(trim(a.trainer_name), '\s+', ' ', 'g')) as k,
      trim(regexp_replace(a.trainer_name, '\s+', ' ', 'g')) as raw,
      c.club_number, a.status, a.outcome
    from public.day_one_appointments a
    join clubmap c on c.slug = a.location_slug
    where a.trainer_name is not null and trim(a.trainer_name) <> ''
      and a.booked_at::date between p_start and p_end
      and (p_clubs is null or c.club_number = any(p_clubs))
  ),
  -- Money: credited to the commission employee, falling back to the deliverer
  -- only where payroll has no row for that sale. See the header.
  svc as (
    select
      coalesce(
        lower(regexp_replace(trim(p.employee_name), '\s+', ' ', 'g')),
        lower(regexp_replace(trim(s.trainer_name), '\s+', ' ', 'g'))
      ) as k,
      coalesce(
        trim(regexp_replace(p.employee_name, '\s+', ' ', 'g')),
        trim(regexp_replace(s.trainer_name, '\s+', ' ', 'g'))
      ) as raw,
      s.club_number, s.member_id, s.sale_date as d,
      coalesce(s.invoice_total, 0) as amount,
      (p.employee_name is null) as estimated
    from public.abc_pt_services s
    left join public.payroll_recurring_commissions p
      on p.recurring_service_id = s.recurring_service_id
    where s.sale_date between p_start and p_end
      and trim(coalesce(p.employee_name, s.trainer_name, '')) <> ''
      and (p_clubs is null or s.club_number = any(p_clubs))
  ),
  -- Clients: the service employee. Only used to lengthen the relationship
  -- window below; the session counts come from ev, which already records who
  -- actually ran each one.
  svc_service as (
    select
      lower(regexp_replace(trim(s.trainer_name), '\s+', ' ', 'g')) as k,
      s.member_id, s.sale_date as d
    from public.abc_pt_services s
    where s.trainer_name is not null and trim(s.trainer_name) <> '' and s.member_id is not null
  ),
  -- Every name from any source; see the header on why this is not an inner join.
  people as (
    select k, max(raw) as raw from (
      select k, raw from ev union all select k, raw from d1 union all select k, raw from svc
    ) z group by k
  ),
  -- One club per trainer: wherever they did the most work, weighting sessions
  -- above intros, so someone covering a shift elsewhere is not re-filed.
  home as (
    select distinct on (k) k, club_number
    from (
      select k, club_number, count(*) * 10 as w from ev group by 1,2
      union all select k, club_number, count(*) as w from d1 group by 1,2
      union all select k, club_number, count(*) as w from svc group by 1,2
    ) z
    group by k, club_number
    order by k, sum(w) desc
  ),
  sess as (
    select
      k,
      max(d) filter (where status = 'Completed') as last_session,
      count(distinct member_id) filter (where status = 'Completed' and member_id is not null) as unique_members,
      count(*) filter (where status = 'Completed') as completed_sessions,
      -- Canceled-Charge is the only cancelled state ABC records on these events.
      count(*) filter (where status like 'Canceled%') as cancelled_sessions,
      coalesce(sum(mins) filter (where status = 'Completed'), 0) as session_minutes,
      coalesce(sum(mins) filter (where status = 'Completed' and category = 'Appointment'), 0) as pt_minutes,
      coalesce(sum(mins) filter (where status = 'Completed' and category = 'Class'), 0) as class_minutes
    from ev group by k
  ),
  -- HOW LONG A MEMBER HAS BEEN WITH THIS TRAINER.
  --
  -- Read across ALL time, not the selected window. Computed from window-filtered
  -- rows every relationship looks one month old, because first and last contact
  -- are then both inside the window — a July report said every trainer's members
  -- had been with them 0.5 months. Across all time the same report reads 17.8,
  -- 15.4, 6.2, which is the right order of magnitude.
  --
  -- PT purchases count as contact too, so a member who bought in 2024 and still
  -- trains reads as a long relationship rather than starting wherever the
  -- calendar feed happens to begin (2026-01).
  contact as (
    select k, member_id, min(d) as first_d, max(d) as last_d
    from (
      select
        lower(regexp_replace(trim(e.employee_first_name || ' ' || e.employee_last_name), '\s+', ' ', 'g')) as k,
        e.member_id, e.event_timestamp_local::date as d
      from public.abc_calendar_events e
      where e.employee_first_name is not null and e.member_id is not null
      union all
      select k, member_id, d from svc_service
    ) z
    group by 1, 2
  ),
  -- Averaged only over the members actually trained in the window.
  trained as (
    select distinct k, member_id from ev
    where status = 'Completed' and member_id is not null
  ),
  months as (
    select t.k,
           round(avg(greatest(least(c.last_d, p_end) - c.first_d, 0) / 30.44)::numeric, 1) as member_months
    from trained t
    join contact c on c.k = t.k and c.member_id = t.member_id
    group by t.k
  ),
  intros as (
    select k,
      count(*) as booked,
      count(*) filter (where status = 'completed') as completed,
      count(*) filter (where status = 'completed' and outcome = 'Sale') as sold
    from d1 group by k
  ),
  sales as (
    select k, coalesce(sum(amount), 0) as close_amount, bool_or(estimated) as estimated
    from svc group by k
  )
  select
    p.raw, home.club_number, sess.last_session,
    coalesce(sess.unique_members, 0), coalesce(sess.completed_sessions, 0),
    coalesce(sess.cancelled_sessions, 0), coalesce(sess.session_minutes, 0),
    coalesce(sess.pt_minutes, 0), coalesce(sess.class_minutes, 0),
    months.member_months,
    coalesce(intros.booked, 0), coalesce(intros.completed, 0), coalesce(intros.sold, 0),
    coalesce(sales.close_amount, 0),
    coalesce(sales.estimated, false)
  from people p
  left join home   on home.k = p.k
  left join sess   on sess.k = p.k
  left join months on months.k = p.k
  left join intros on intros.k = p.k
  left join sales  on sales.k = p.k
  order by coalesce(sess.completed_sessions, 0) desc, p.raw;
$function$;

-- The headline row.
--
-- It exists because UNIQUE MEMBERS TRAINED IS NOT ADDITIVE. A member who trains
-- with two trainers is one member and two per-trainer rows: for July 2026 the
-- true figure is 583 and the naive sum is 634. Everything else here could be
-- pooled in JS, but that one cannot, and computing half a headline in SQL and
-- half in JS is how the two halves drift apart.
create or replace function public.analytics_trainer_performance_totals(
  p_start date,
  p_end   date,
  p_clubs text[] default null
)
returns table (
  unique_members     bigint,
  trainers           bigint,
  completed_sessions bigint,
  cancelled_sessions bigint,
  session_minutes    bigint,
  pt_minutes         bigint,
  class_minutes      bigint,
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
  ev as (
    select e.member_id, e.status, e.category, coalesce(e.duration_minutes, 0) as mins,
           lower(regexp_replace(trim(e.employee_first_name || ' ' || e.employee_last_name), '\s+', ' ', 'g')) as k
    from public.abc_calendar_events e
    where e.employee_first_name is not null
      and e.event_timestamp_local::date between p_start and p_end
      and (p_clubs is null or e.club_number = any(p_clubs))
  ),
  d1 as (
    select a.status, a.outcome
    from public.day_one_appointments a
    join clubmap c on c.slug = a.location_slug
    where a.trainer_name is not null and trim(a.trainer_name) <> ''
      and a.booked_at::date between p_start and p_end
      and (p_clubs is null or c.club_number = any(p_clubs))
  ),
  svc as (
    select coalesce(s.invoice_total, 0) as amount
    from public.abc_pt_services s
    where s.trainer_name is not null and trim(s.trainer_name) <> ''
      and s.sale_date between p_start and p_end
      and (p_clubs is null or s.club_number = any(p_clubs))
  )
  select
    (select count(distinct member_id) from ev where status = 'Completed' and member_id is not null),
    (select count(distinct k) from ev where status = 'Completed'),
    (select count(*) from ev where status = 'Completed'),
    (select count(*) from ev where status like 'Canceled%'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed' and category = 'Appointment'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed' and category = 'Class'),
    (select count(*) from d1),
    (select count(*) from d1 where status = 'completed'),
    (select count(*) from d1 where status = 'completed' and outcome = 'Sale'),
    (select coalesce(sum(amount), 0) from svc);
$function$;
