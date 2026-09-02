-- 180: Pending-outcome Day Ones, as rows rather than as a count.
--
-- WHAT "PENDING" MEANS
-- A Day One whose date has PASSED and which nobody has closed out: still
-- `scheduled` with no outcome recorded. This is exactly the `Passed, no outcome`
-- arm of day_one_appointments_v.display_status (migration 120), restated here as
-- a filter so the definition lives in one place and both agree by construction.
--
-- Today never counts. An 8am intro must not be reported as missing an outcome
-- from midnight onwards, so the cutoff is the Pacific-local current date and the
-- comparison is strictly less-than. Same rule as the view.
--
-- WHY ROWS, NOT A COUNT
-- The whole point of the metric is "who do we chase". A number says 14 are
-- outstanding; rows say which trainer, which club, which member, and how long it
-- has been sitting. Every caller aggregates these differently -- per club, per
-- trainer, per booker, per day -- and one function returning rows serves all of
-- them without six near-identical count functions drifting apart.
--
-- The volume is small by construction: ~300 Day Ones a month across all seven
-- clubs, of which the pending ones are a fraction, so a month window returns
-- tens of rows, not thousands. This is nothing like a member scan.
--
-- WHY THIS IS NOT BOLTED ONTO THE EXISTING FUNCTIONS
-- analytics_trainer_performance, analytics_trainer_monthly and
-- analytics_pt_scorecard all key their Day One counts on booked_at -- the month
-- the intro was PUT IN THE DIARY. Pending has to key on scheduled_date -- the
-- day it was SUPPOSED TO HAPPEN -- or "how many passed without an outcome"
-- silently means "how many booked in this window have not been closed out",
-- which counts an intro booked in June for a July date as June's problem.
-- Mixing the two keys inside one row would put two different populations under
-- one heading. So this is its own function on its own key, and every caller that
-- surfaces it labels it by appointment date.

-- The scan is (club, date) over a small slice of an already-small table. Partial
-- on status so the index holds only rows that can ever be pending -- a completed
-- or cancelled Day One never becomes one again.
create index if not exists day_one_appointments_pending_idx
  on public.day_one_appointments (location_slug, scheduled_date)
  where status = 'scheduled';

create or replace function public.analytics_day_one_pending(
  p_start date,
  p_end   date,
  p_clubs text[] default null
)
returns table (
  id             uuid,
  location_slug  text,
  club_number    text,
  scheduled_date date,
  days_overdue   integer,
  contact_name   text,
  trainer_name   text,
  booked_by_name text,
  booked_at      timestamptz
)
language sql
stable
as $$
  with clubmap(club_number, slug) as (values
    ('30935','salem'),('31599','keizer'),('7655','eugene'),('31598','springfield'),
    ('31600','clackamas'),('31601','milwaukie'),('32073','medford')
  ),
  today as (select (now() at time zone 'America/Los_Angeles')::date as d)
  select
    a.id,
    a.location_slug,
    c.club_number,
    a.scheduled_date,
    (today.d - a.scheduled_date)::integer as days_overdue,
    a.contact_name,
    -- Empty strings are as absent as nulls here; a caller bucketing by trainer
    -- must not end up with an "" bucket beside an Unassigned one.
    nullif(btrim(coalesce(a.trainer_name, '')), '')   as trainer_name,
    nullif(btrim(coalesce(a.booked_by_name, '')), '') as booked_by_name,
    a.booked_at
  from public.day_one_appointments a
  join clubmap c on c.slug = a.location_slug
  cross join today
  where a.status = 'scheduled'
    and a.scheduled_date < today.d
    and a.scheduled_date between p_start and p_end
    and (p_clubs is null
         or c.club_number = any(select ltrim(x, '0') from unnest(p_clubs) x))
  order by a.scheduled_date, a.location_slug, a.id;
$$;

comment on function public.analytics_day_one_pending is
  'Day Ones whose scheduled date has passed (Pacific) with no outcome recorded -- one row each, so callers can count them by club, trainer, booker or day. Same rule as day_one_appointments_v.display_status = ''Passed, no outcome''.';
