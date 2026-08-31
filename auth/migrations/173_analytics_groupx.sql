-- 173_analytics_groupx.sql
--
-- Analytics > Group X. Attendance per class, hour, weekday, month and
-- instructor, plus how much of the schedule actually got counted.
--
-- BUILT BEFORE THE DATA EXISTS, DELIBERATELY. Headcount capture is about to
-- start; one row has ever been recorded. A report that only works once the data
-- is flowing is a report nobody can check while they are learning to record it,
-- so the coverage half below matters more than the attendance half for now.
--
-- TWO SIDES, AND THE GAP BETWEEN THEM IS THE POINT:
--
--   RECORDED   group_x_class_attendance — one row per class somebody counted.
--   SCHEDULED  group_x_series expanded over the window by weekday — every class
--              that was meant to happen.
--
-- Reporting only what was recorded would make a club that counted one class out
-- of forty look like a club with one class. The schedule is what turns "we
-- recorded 12 classes" into "we recorded 12 of 47".
--
-- LOCAL TIME, NOT UTC. Hour of day is the entire point of a class-attendance
-- report — a 5am class and a 5pm class are different products — and bucketing
-- on UTC would move every evening class into the following day, the same trap
-- that dated Problem Areas jobs a day forward in #740.
--
-- Local time is DERIVED from event_timestamp, which is a real timestamptz,
-- rather than read from event_timestamp_local, which is TEXT. The two agree
-- today, but a text column carries no guarantee of format and a cast on it
-- throws the moment one row is written differently. The typed column cannot.
--
-- UTILISATION IS NOT CLAMPED. The one recorded class had 11 people in a room set
-- for 10. Capping at 100% would hide exactly the classes worth knowing about,
-- and a null max_attendees yields a null rate rather than a divide by zero.

-- ---------------------------------------------------------------------------
-- What was actually counted.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_groupx_attendance(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  slug text,
  class_date date,
  hour int,
  dow int,
  month date,
  class_name text,
  instructor_name text,
  headcount int,
  max_attendees int,
  utilisation numeric,
  recorded_by text
)
language sql
stable
as $$
  select
    c.slug,
    (a.event_timestamp at time zone 'America/Los_Angeles')::date,
    extract(hour from (a.event_timestamp at time zone 'America/Los_Angeles'))::int,
    extract(dow from (a.event_timestamp at time zone 'America/Los_Angeles'))::int,
    date_trunc('month', (a.event_timestamp at time zone 'America/Los_Angeles'))::date,
    coalesce(nullif(btrim(a.class_name), ''), '(unnamed class)'),
    coalesce(nullif(btrim(a.instructor_name), ''), '(no instructor)'),
    a.headcount,
    a.max_attendees,
    -- Uncapped on purpose: a class over its limit is the interesting one.
    round(100.0 * a.headcount / nullif(a.max_attendees, 0), 1),
    nullif(btrim(a.recorded_by), '')
  from public.group_x_class_attendance a
  join public.analytics_checkin_clubs() c
    on c.club_number = ltrim(a.club_number, '0')
  where (a.event_timestamp at time zone 'America/Los_Angeles')::date >= p_start
    and (a.event_timestamp at time zone 'America/Los_Angeles')::date <= p_end
    and (p_clubs is null or c.slug = any(p_clubs))
  order by 2 desc, 3
$$;

-- ---------------------------------------------------------------------------
-- What was meant to happen.
--
-- Each series is expanded across the window by weekday. A series with no
-- ends_on runs indefinitely, and one cancelled part-way stops on its
-- cancellation date rather than vanishing from history — the classes it held
-- before then did happen.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_groupx_scheduled(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  slug text,
  class_date date,
  hour int,
  dow int,
  month date,
  class_name text,
  instructor_name text,
  series_id uuid
)
language sql
stable
as $$
  select
    c.slug,
    d.day::date,
    extract(hour from s.start_time)::int,
    extract(dow from d.day)::int,
    date_trunc('month', d.day)::date,
    coalesce(nullif(btrim(s.class_name), ''), '(unnamed class)'),
    coalesce(nullif(btrim(s.instructor_name), ''), '(no instructor)'),
    s.id
  from public.group_x_series s
  join public.analytics_checkin_clubs() c
    on c.club_number = ltrim(s.club_number, '0')
  cross join lateral generate_series(
    greatest(s.starts_on, p_start)::date,
    least(coalesce(s.ends_on, p_end), p_end)::date,
    interval '1 day'
  ) d(day)
  where (p_clubs is null or c.slug = any(p_clubs))
    -- weekdays is an int[] of dow values.
    and extract(dow from d.day)::int = any(s.weekdays)
    -- A cancelled series still held its earlier classes; it just stops there.
    and (s.canceled_at is null or d.day::date <= (s.canceled_at at time zone 'America/Los_Angeles')::date)
  order by 2 desc, 3
$$;
