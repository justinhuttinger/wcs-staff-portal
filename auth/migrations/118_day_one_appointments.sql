-- Day One appointments as first-class rows, replacing GHL contact custom fields
-- as the system of record for outcomes, trainer, and booking attribution.
--
-- WHY THIS EXISTS
-- A GHL custom field holds exactly ONE value per contact, forever. A member who
-- books a second Day One silently overwrites the first, so history is destroyed
-- on write and "how many Day Ones has this person had" is unanswerable. The same
-- reasoning already produced day_one_cancellations (migration 107); this table
-- generalises it to the whole lifecycle instead of just the cancel half.
--
-- Measured on 2026-08-25, the fields this replaces:
--   3,929 contacts carry day_one_booked, but only 1,712 have a status and 1,641
--   a date. Every report filters on day_one_date, so ~58% of bookings are
--   invisible to reporting today. Coverage ranges from Medford 100% to Eugene 24%,
--   which means cross-club show-rate comparisons are mostly comparing data entry.

create table if not exists day_one_appointments (
  id                   uuid primary key default gen_random_uuid(),
  location_slug        text        not null,

  -- Null for rows reconstructed from custom fields: those bookings predate this
  -- table and their appointment is long gone. Required would mean inventing one.
  ghl_appointment_id   text,
  ghl_contact_id       text        not null,
  ghl_calendar_id      text,

  -- Denormalised on purpose, same reasoning as day_one_cancellations: the
  -- appointment can be deleted in GHL, and a report of what happened must not
  -- start returning blanks when it is.
  contact_name         text,
  contact_email        text,
  contact_phone        text,

  -- scheduled_date is the REPORTING key and is always present. scheduled_start
  -- is the exact instant and is null for backfilled rows, because the legacy
  -- day_one_date custom field is a date-picker storing UTC midnight: it genuinely
  -- has no time-of-day. Storing a fabricated timestamp would invent precision.
  -- Reports group on scheduled_date, so nothing has to re-derive a Pacific local
  -- day from a UTC instant -- which is the AT TIME ZONE day-walk bug class.
  scheduled_date       date        not null,
  scheduled_start      timestamptz,
  scheduled_end        timestamptz,
  booked_at            timestamptz,

  -- Who gets credit for booking it. Distinct from whoever clicked in GHL:
  -- 94% of Day Ones are created by the GHL booking widget with createdBy.userId
  -- null, so the name arrives from the booking form, not from the appointment.
  booked_by_name       text,
  -- How we learned it, so a possibly-stale value is never mistaken for a
  -- first-hand one: webhook | created_by | booking_widget | reconciler_field | null
  booked_by_source     text,

  trainer_name         text,
  trainer_ghl_user_id  text,
  notes_for_trainer    text,

  -- scheduled | completed | no_show | cancelled
  status               text        not null default 'scheduled',
  -- Sale | No Sale, only meaningful when status = 'completed'
  outcome              text,
  pt_sale_type         text,
  -- Canonical reason from the curated list in lib/dayOneOutcomes.js.
  why_no_sale          text,
  -- Free text, only when why_no_sale = 'Other'. The legacy custom field was
  -- LARGE_TEXT at every club and collected 400+ distinct values, nearly all
  -- with a count of 1 (including 'Poor'/'poor'/'Poor ' as three separate
  -- answers), which is why the canonical column above exists at all.
  why_no_sale_other    text,
  cancel_reason        text,

  outcome_recorded_at  timestamptz,
  -- Self-attested: the outcome form is public and the submitter picks their own
  -- name off the location's trainer roster. Not an identity claim, an audit trail.
  submitted_by         text,

  -- Reschedule chain. GHL preserves the appointment id across an in-place edit
  -- (measured: 424/853 events had dateUpdated > dateAdded with the id intact),
  -- so most reschedules need no link at all. These columns cover the other
  -- shape: cancel one appointment, book a fresh one for the same member.
  rescheduled_from_id  uuid references day_one_appointments(id) on delete set null,
  rescheduled_to_id    uuid references day_one_appointments(id) on delete set null,

  -- booking_widget | webhook | ghl_reconcile | ghl_custom_field_backfill
  source               text        not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table day_one_appointments is
  'One row per Day One appointment. Replaces the day_one_* GHL contact custom fields, which could only ever hold the most recent value per contact.';

-- One row per real GHL appointment.
--
-- Deliberately NOT a partial index. ON CONFLICT cannot infer a partial unique
-- index, so `upsert(..., { onConflict: 'ghl_appointment_id' })` fails against one
-- with "no unique or exclusion constraint matching the ON CONFLICT specification".
-- A plain unique index is inferable and still lets every backfilled row carry a
-- NULL id, because Postgres treats NULLs as distinct in a unique index by default.
create unique index if not exists day_one_appointments_ghl_id_idx
  on day_one_appointments (ghl_appointment_id);

-- "Day Ones for this club over this period", the shape every report wants.
create index if not exists day_one_appointments_loc_date_idx
  on day_one_appointments (location_slug, scheduled_date desc);

-- Powers the outcome form's "the open Day One for this contact" lookup, which is
-- the query that makes {{contact.id}} sufficient and a custom field unnecessary.
create index if not exists day_one_appointments_contact_open_idx
  on day_one_appointments (ghl_contact_id, scheduled_date desc)
  where outcome_recorded_at is null;

-- Reschedule stitching scans recent rows for one contact regardless of state.
create index if not exists day_one_appointments_contact_idx
  on day_one_appointments (ghl_contact_id, scheduled_date desc);

-- Append-only history. The parent row always holds CURRENT state; this holds how
-- it got there, so "how often do Day Ones get rescheduled" becomes answerable.
-- Measured 2026-08-25: 162/853 appointments (19%) carried GHL's rescheduledAt and
-- 128/853 (15%) were cancelled, so roughly a third change state after booking.
create table if not exists day_one_appointment_events (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid        not null references day_one_appointments(id) on delete cascade,
  -- booked | rescheduled | reassigned | cancelled | outcome_recorded | restored
  event_type     text        not null,
  from_value     jsonb,
  to_value       jsonb,
  -- webhook | reconciler | form | backfill
  detected_by    text        not null,
  occurred_at    timestamptz not null default now()
);

comment on table day_one_appointment_events is
  'Append-only history of Day One appointment state changes. Never updated in place.';

create index if not exists day_one_appointment_events_appt_idx
  on day_one_appointment_events (appointment_id, occurred_at desc);

-- The portal DB is service-role only. Enable RLS with no policy so nothing is
-- reachable if an anon key ever leaks. Both of these hold member contact details.
alter table day_one_appointments       enable row level security;
alter table day_one_appointment_events enable row level security;
