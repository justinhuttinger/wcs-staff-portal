-- 184: separate what a trainer's diary actually holds.
--
-- ABC files a member's training session, an hour of desk work and a sales
-- consult under one category, so every report that counted "Completed
-- Appointments" counted all three as the same thing.
--
-- Measured for August 2026: analytics_trainer_performance_totals reported
-- 2,128 completed sessions. Only 1,898 of those had a member attached. The
-- other 225 were Admin (184), Floor Hour (31) and PT Consult #2 (10) — desk
-- time and sales appointments counted as training, inflating every trainer's
-- session count by about 10.6%.
--
-- FOUR KINDS, matching lib/calendarEventKind exactly so SQL and JS cannot
-- disagree about what a session is:
--
--   session  training delivered to a member
--   consult  a Day One / PT consult — a sales appointment, not training
--   admin    desk time, floor hours, blocked diary. Not client work
--   class    a group class, which ABC already separates by category
--
-- MATCHED ON SHAPE, NOT A LIST. The names are per-club and hand-typed: PT
-- Consult, PT Consult 1 and PT Consult #2 all exist. A club adding "PT Consult
-- 3" tomorrow classifies correctly with no migration; a hardcoded list would
-- silently count it as training.
--
-- 183 was skipped: 182 is already used twice (group_x_series_events and
-- membership_daily_snapshots), so the next free number is taken deliberately
-- rather than adding a third collision.

create or replace function public.abc_calendar_event_kind(
  p_event_name text,
  p_category   text
)
returns text
language sql
immutable
as $$
  select case
    -- ABC's own category is right about classes, and a class named "Small Group
    -- Training" would otherwise read as a session.
    when lower(coalesce(p_category, '')) = 'class' then 'class'
    when coalesce(p_event_name, '') ~* '^\s*(admin|floor\s*hour|unavailable|blocked|break|lunch|meeting)' then 'admin'
    when coalesce(p_event_name, '') ~* 'consult' then 'consult'
    else 'session'
  end
$$;

comment on function public.abc_calendar_event_kind is
  'session | consult | admin | class for a calendar event. Mirrors lib/calendarEventKind — change both together.';

-- ---------------------------------------------------------------------------
-- Trainer performance, with the three kinds kept apart.
--
-- The OUT columns change, so the old signatures have to go first: CREATE OR
-- REPLACE cannot change a function's return type.
-- ---------------------------------------------------------------------------

drop function if exists public.analytics_trainer_performance(date, date, text[]);
drop function if exists public.analytics_trainer_performance_totals(date, date, text[]);

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
  -- New, and deliberately beside the sessions rather than inside them.
  consult_sessions   bigint,
  admin_sessions     bigint,
  session_minutes    bigint,
  pt_minutes         bigint,
  class_minutes      bigint,
  admin_minutes      bigint,
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
      e.status, e.category, coalesce(e.duration_minutes, 0) as mins,
      public.abc_calendar_event_kind(e.event_name, e.category) as kind
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
  svc_service as (
    select
      lower(regexp_replace(trim(s.trainer_name), '\s+', ' ', 'g')) as k,
      s.member_id, s.sale_date as d
    from public.abc_pt_services s
    where s.trainer_name is not null and trim(s.trainer_name) <> '' and s.member_id is not null
  ),
  people as (
    select k, max(raw) as raw from (
      select k, raw from ev union all select k, raw from d1 union all select k, raw from svc
    ) z group by k
  ),
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
      -- SESSIONS ARE TRAINING ONLY. Admin and consults are counted beside them,
      -- never inside them, which is the whole point of this migration.
      max(d) filter (where status = 'Completed' and kind = 'session') as last_session,
      count(distinct member_id) filter (where status = 'Completed' and kind = 'session' and member_id is not null) as unique_members,
      count(*) filter (where status = 'Completed' and kind = 'session') as completed_sessions,
      count(*) filter (where status like 'Canceled%' and kind = 'session') as cancelled_sessions,
      count(*) filter (where status = 'Completed' and kind = 'consult') as consult_sessions,
      count(*) filter (where status = 'Completed' and kind = 'admin') as admin_sessions,
      coalesce(sum(mins) filter (where status = 'Completed' and kind = 'session'), 0) as session_minutes,
      coalesce(sum(mins) filter (where status = 'Completed' and kind = 'session' and category = 'Appointment'), 0) as pt_minutes,
      coalesce(sum(mins) filter (where status = 'Completed' and kind = 'class'), 0) as class_minutes,
      coalesce(sum(mins) filter (where status = 'Completed' and kind = 'admin'), 0) as admin_minutes
    from ev group by k
  ),
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
  trained as (
    select distinct k, member_id from ev
    where status = 'Completed' and kind = 'session' and member_id is not null
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
    coalesce(sess.cancelled_sessions, 0),
    coalesce(sess.consult_sessions, 0), coalesce(sess.admin_sessions, 0),
    coalesce(sess.session_minutes, 0),
    coalesce(sess.pt_minutes, 0), coalesce(sess.class_minutes, 0),
    coalesce(sess.admin_minutes, 0),
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
  consult_sessions   bigint,
  admin_sessions     bigint,
  session_minutes    bigint,
  pt_minutes         bigint,
  class_minutes      bigint,
  admin_minutes      bigint,
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
           public.abc_calendar_event_kind(e.event_name, e.category) as kind,
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
    (select count(distinct member_id) from ev where status = 'Completed' and kind = 'session' and member_id is not null),
    -- Somebody whose whole month was admin is still a trainer on the payroll,
    -- so the head count is anyone who completed anything, not just sessions.
    (select count(distinct k) from ev where status = 'Completed'),
    (select count(*) from ev where status = 'Completed' and kind = 'session'),
    (select count(*) from ev where status like 'Canceled%' and kind = 'session'),
    (select count(*) from ev where status = 'Completed' and kind = 'consult'),
    (select count(*) from ev where status = 'Completed' and kind = 'admin'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed' and kind = 'session'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed' and kind = 'session' and category = 'Appointment'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed' and kind = 'class'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed' and kind = 'admin'),
    (select count(*) from d1),
    (select count(*) from d1 where status = 'completed'),
    (select count(*) from d1 where status = 'completed' and outcome = 'Sale'),
    (select coalesce(sum(amount), 0) from svc)
$function$;
