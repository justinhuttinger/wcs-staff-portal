-- The status a human should see, which is not the same as the status stored.
--
-- "Passed, no outcome" is DERIVED, never stored. It is the difference between a
-- Day One that has not happened yet and one that happened and nobody recorded.
-- Storing it would need a job flipping rows at midnight in the right timezone,
-- and a row would be wrong for however long that job was late or broken.
--
-- This distinction is the whole reporting win. Against the old GHL custom fields
-- both cases looked identical: a booking with no status, silently dropped from
-- every report because it had no date to filter on.
create or replace view day_one_appointments_v as
select
  a.*,
  case
    when a.status = 'cancelled' then 'Cancelled'
    when a.status = 'completed' then 'Completed'
    when a.status = 'no_show'   then 'No Show'
    -- Still open. Today counts as Scheduled: an 8am session should not be
    -- reported as missing an outcome from midnight onwards.
    when a.scheduled_date < (now() at time zone 'America/Los_Angeles')::date
      then 'Passed, no outcome'
    else 'Scheduled'
  end as display_status
from day_one_appointments a;

comment on view day_one_appointments_v is
  'day_one_appointments plus display_status, which distinguishes an upcoming Day One from one that passed with nobody recording an outcome.';
