-- The Day One calendar allowlist, where the integrity check can read it.
--
-- WHY THIS TABLE EXISTS
-- Migration 121 hardcoded seven calendar ids into day_one_integrity(). Two weeks
-- later #874 established that Clackamas also runs Day Ones on "Stretch" and
-- Milwaukie on "Kirstyn Pagano-Jackson's Calendar" -- real Day Ones, added to the
-- allowlist in config/dayOneCalendars.js. Nobody updated the SQL, because the
-- SQL was a second copy of the same list.
--
-- The result: 61 correct rows counted as phantom_calendars, which is a hard
-- failure, so the Monday check texted "a GHL workflow trigger is no longer
-- scoped to the Day One calendar" every week about rows that were right by
-- design. A weekly alarm that is always wrong is worse than no alarm -- it is
-- how a real one gets ignored.
--
-- So the list stops being a copy. config/dayOneCalendars.js resolves its names
-- against GHL every hour per club anyway; it now records what it resolved here,
-- and the check reads that. One source of truth, and adding a club's calendar
-- stays the one-line edit #874 made it.
--
-- THE CHECK STILL CATCHES WHAT IT WAS BUILT TO CATCH. A workflow trigger
-- mis-scoped to Gym Tours writes rows carrying a calendar id the resolver never
-- looked up and never registered, so those rows still flag. What can no longer
-- flag is a calendar we deliberately added.
--
-- ROWS ARE NEVER DELETED. If a calendar is renamed in GHL the resolver stops
-- finding it (and warns loudly, by name), but its id stays registered so the
-- Day Ones already booked on it do not retroactively become phantoms.

create table if not exists day_one_calendars (
  ghl_calendar_id  text primary key,
  location_slug    text not null,
  calendar_name    text,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);

comment on table day_one_calendars is
  'Calendar ids resolved from the allowlist in auth/src/config/dayOneCalendars.js. Written by the resolver, read by day_one_integrity(). Never deleted: a renamed calendar keeps its history out of phantom_calendars.';

-- Seeded so the check is correct from the moment this migration applies, rather
-- than from the first reconcile pass -- and so it stays correct if the
-- reconciler is ever disabled. These are the nine ids live in prod today: the
-- seven from migration 121 plus the two #874 added.
insert into day_one_calendars (ghl_calendar_id, location_slug, calendar_name) values
  ('Gq92GXsDRAgTGZeHh7mx', 'salem',       'Day One'),
  ('8qFo1GnePy0mCgV9avWW', 'keizer',      'Day One'),
  ('0c9CNdZ65NainMcStWXo', 'eugene',      'Day One'),
  ('PEyaqnkjmBN5tLpo6I9F', 'springfield', 'Day One'),
  ('yOvDLsZMAboTVjv9c2HC', 'clackamas',   'Day One'),
  ('bYCefFhbcgvT2pxeQ5F2', 'milwaukie',   'Day One'),
  ('TWhn2xXdvPOQtExACC9j', 'medford',     'Day One'),
  ('NsZFO6Kl8D3h2nZaw4RE', 'clackamas',   'Stretch'),
  ('iJRA34XwSQnKmogrs0Cm', 'milwaukie',   'Kirstyn Pagano-Jackson''s Calendar')
on conflict (ghl_calendar_id) do nothing;

-- Only the phantom_calendars branch changes. The rest is migration 121 verbatim,
-- because create or replace function has to restate the whole body and each
-- comment names the incident that check exists for.
create or replace function day_one_integrity()
returns table (key text, count bigint)
language sql
stable
as $$
  -- A webhook that could not name its appointment. The reconciler cannot match
  -- these, so they double-count against the row it creates itself.
  select 'orphan_rows', count(*) from day_one_appointments
    where ghl_appointment_id is null and source <> 'ghl_custom_field_backfill'

  union all
  -- Tours, swim lessons and Stretch share the sub-accounts; Clackamas alone has
  -- eight calendars. A mis-scoped workflow trigger inflates Day One counts with
  -- appointments that were never Day Ones.
  select 'phantom_calendars', count(*) from day_one_appointments a
    where a.ghl_calendar_id is not null and not exists (
      select 1 from day_one_calendars c where c.ghl_calendar_id = a.ghl_calendar_id)

  union all
  -- A repair once copied outcome_recorded_at onto live rows. Five Day Ones, two
  -- still upcoming, became unrecordable: the form skips whatever the flag calls
  -- done.
  select 'recorded_without_outcome', count(*) from day_one_appointments
    where outcome_recorded_at is not null and outcome is null and status = 'scheduled'

  union all
  -- A later GHL cancellation used to overwrite a recorded outcome, leaving a row
  -- reading Cancelled while carrying a sale.
  select 'sale_without_attendance', count(*) from day_one_appointments_v
    where outcome is not null and display_status <> 'Completed'

  union all
  -- The first backfill deduplicated only against its own rows and created 437
  -- duplicate pairs of live appointments.
  select 'backfill_duplicates_live', count(*) from day_one_appointments b
    where b.source = 'ghl_custom_field_backfill' and exists (
      select 1 from day_one_appointments r
      where r.source <> 'ghl_custom_field_backfill'
        and r.ghl_contact_id = b.ghl_contact_id
        and r.scheduled_date = b.scheduled_date)

  union all
  select 'duplicate_appointment_id', count(*) from (
    select ghl_appointment_id from day_one_appointments
    where ghl_appointment_id is not null group by 1 having count(*) > 1) x

  union all
  -- Every report groups on scheduled_date, so a null drops the Day One out of
  -- reporting entirely, which is the exact failure this migration was built to
  -- end.
  select 'missing_scheduled_date', count(*) from day_one_appointments
    where scheduled_date is null

  union all
  -- Three rows logged a state change every fifteen minutes for three days. The
  -- write was suppressed and the event was not, so history filled with 1,043
  -- changes that never happened.
  select 'repeated_reconciler_events', count(*) from (
    select appointment_id, event_type from day_one_appointment_events
    where detected_by = 'reconciler' and occurred_at > now() - interval '7 days'
    group by 1, 2 having count(*) > 5) y

  union all
  -- NOT a fault: the data is right, a human did not fill the form in. Reported
  -- apart from the failures so a staffing gap never reads as a broken system.
  select 'passed_no_outcome_14d', count(*) from day_one_appointments_v
    where display_status = 'Passed, no outcome' and scheduled_date >= current_date - 14
$$;

comment on function day_one_integrity is
  'Counts for each Day One data integrity check. Non-zero means investigate, except passed_no_outcome_14d which is a data-entry measure. The phantom_calendars allowlist lives in day_one_calendars.';
