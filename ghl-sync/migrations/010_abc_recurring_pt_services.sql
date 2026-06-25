-- Migration: active recurring PT agreements, synced from ABC
-- /members/recurringservices for the PT Projections report.
--
-- The report needs every ACTIVE, non-PIF, PT recurring agreement with its next
-- billing date and amount. ABC only lets you page recurring services by a
-- sale/lastModified date range, so enumerating active agreements requires a
-- wide 2020->today scan per club. Doing that on every report load is slow and
-- times out for the oldest club (Eugene). Instead ghl-sync runs that scan once
-- daily in the background and stores the active set here; the report reads this
-- table and loads instantly.
--
-- One row per (club_number, recurring_service_id). Rows that are no longer
-- active are deleted by the sync (per club) so the table is the current active
-- set as of synced_at.

CREATE TABLE IF NOT EXISTS abc_recurring_pt_services (
  club_number            TEXT NOT NULL,
  recurring_service_id   TEXT NOT NULL,
  location_slug          TEXT,
  member_id              TEXT,
  member_name            TEXT,
  service_employee_id    TEXT,
  trainer_name           TEXT,
  service_item           TEXT,
  next_billing_date      DATE,
  invoice_total          NUMERIC(10,2) DEFAULT 0,
  recurring_type_desc    TEXT,
  status                 TEXT,
  synced_at              TIMESTAMPTZ DEFAULT now(),
  raw                    JSONB,
  PRIMARY KEY (club_number, recurring_service_id)
);

CREATE INDEX IF NOT EXISTS abc_recurring_pt_loc_date
  ON abc_recurring_pt_services (location_slug, next_billing_date);
CREATE INDEX IF NOT EXISTS abc_recurring_pt_club
  ON abc_recurring_pt_services (club_number);

-- Portal DB access is 100% service-role; enable RLS with no policy so the table
-- is locked to anon/auth keys (matches the project-wide RLS sweep).
ALTER TABLE abc_recurring_pt_services ENABLE ROW LEVEL SECURITY;
