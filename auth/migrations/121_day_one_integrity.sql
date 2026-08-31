-- The Day One data integrity checks, as one function.
--
-- Every check exists because that failure ACTUALLY HAPPENED, and in each case no
-- report would have caught it: the numbers would simply have been wrong. The
-- comment on each names the incident, so nobody removes one for looking
-- theoretical.
--
-- Counting lives here rather than in JS so the service needs no dynamic SQL, and
-- so a check cannot be a hand-built string with a table name in it.
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
  select 'phantom_calendars', count(*) from day_one_appointments
    where ghl_calendar_id is not null and ghl_calendar_id not in (
      'Gq92GXsDRAgTGZeHh7mx','8qFo1GnePy0mCgV9avWW','0c9CNdZ65NainMcStWXo',
      'PEyaqnkjmBN5tLpo6I9F','yOvDLsZMAboTVjv9c2HC','bYCefFhbcgvT2pxeQ5F2',
      'TWhn2xXdvPOQtExACC9j')

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
  'Counts for each Day One data integrity check. Non-zero means investigate, except passed_no_outcome_14d which is a data-entry measure.';
