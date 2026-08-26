-- When GHL last touched the appointment, as GHL reports it (dateUpdated).
--
-- Adoption matches an orphan webhook row to its appointment by WHEN THE BOOKING
-- HAPPENED, because the orphan's own date is unreliable (GHL's {{appointment.*}}
-- merge fields do not resolve, so it defaults to today).
--
-- Comparing only against dateAdded breaks on a reschedule: the appointment was
-- created 31 minutes before the reschedule webhook fired, so nothing matched and
-- the fallback landed on an unrelated appointment that happened to share the
-- orphan's provisional date. GHL's dateUpdated for that same reschedule was 4
-- SECONDS from the webhook, which is decisive.
alter table day_one_appointments
  add column if not exists ghl_updated_at timestamptz;

comment on column day_one_appointments.ghl_updated_at is
  'GHL dateUpdated for this appointment. Used to match an orphan webhook row to the appointment it describes.';
