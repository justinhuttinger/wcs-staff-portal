-- Why members cancel their Day One.
--
-- Deliberately NOT reusing contact.cancel_reason / contact.reason_for_cancellation_1:
-- those are MEMBERSHIP cancellation fields ("Moving / Relocation", "Financial
-- Reasons", "Non - Use"...) and writing appointment reasons into them would
-- corrupt membership reporting.
--
-- The reason is also written to the contact in GHL (contact.day_one_cancel_reason)
-- so front desk sees it without opening a report; this table is the reportable
-- copy, since a GHL custom field only ever holds the most recent value and is
-- overwritten on the next cancellation.
create table if not exists day_one_cancellations (
  id                  uuid primary key default gen_random_uuid(),
  location_slug       text        not null,
  ghl_contact_id      text        not null,
  ghl_appointment_id  text        not null,
  contact_name        text,
  contact_email       text,
  contact_phone       text,
  -- Who was going to run it. Kept denormalized: the appointment is cancelled in
  -- GHL right after this row is written, so the assignment is not recoverable later.
  assigned_user_id    text,
  trainer_name        text,
  appointment_start   timestamptz,
  reason              text        not null,
  notes               text,
  cancelled_at        timestamptz not null default now()
);

comment on table day_one_cancellations is
  'Day One appointment cancellations with the member''s stated reason. Distinct from membership cancellations.';

-- Reporting is "cancellations for this club over this period", so index that pair.
create index if not exists day_one_cancellations_loc_time_idx
  on day_one_cancellations (location_slug, cancelled_at desc);

-- One row per cancellation of a given appointment: a member double-submitting
-- the form must not create duplicates that inflate the counts.
create unique index if not exists day_one_cancellations_appointment_idx
  on day_one_cancellations (ghl_appointment_id);

-- Portal DB is service-role only. Enable RLS with no policy so nothing is
-- reachable if an anon key ever leaks.
alter table day_one_cancellations enable row level security;
