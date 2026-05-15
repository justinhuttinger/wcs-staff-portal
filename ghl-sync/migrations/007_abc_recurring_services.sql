-- ABC Recurring Services — one row per ABC `recurringService` entity that
-- matters for the PT reports. Synced from ABC's
-- /{clubNumber}/members/recurringservices endpoint.
--
-- Feeds: Deactivated PT, PT New Clients, PT Roster, PT Health.
--
-- The current /reports/* routes still hit ABC live; this table is populated
-- so a follow-up PR can flip the consumers behind a feature flag (per the
-- Phase 3 plan in docs/superpowers/specs/2026-05-14-portal-perf-phase-2-3-design.md).
--
-- Only PT-shaped services are stored (isPT check in syncRecurringServices.js
-- — matches what the existing report code filters on). Non-PT services are
-- skipped at sync time to keep this table focused.

CREATE TABLE IF NOT EXISTS abc_recurring_services (
  -- Identity
  recurring_service_id   TEXT NOT NULL,
  club_number            TEXT NOT NULL,

  -- Member
  member_id              TEXT,
  member_first_name      TEXT,
  member_last_name       TEXT,

  -- Service definition
  service_item           TEXT,                 -- e.g. "PT 60MIN" (short label)
  service_plan_id        TEXT,
  service_plan_name      TEXT,                 -- e.g. "PT60 3X/WEEK 12 MONTHS"
  recurring_type_desc    TEXT,                 -- "Recurring", "Paid in Full", etc.
  is_pif                 BOOLEAN DEFAULT FALSE,-- derived from recurring_type_desc

  -- Pricing
  invoice_total          NUMERIC(12,2),        -- per-invoice charge
  total_periods          INTEGER,              -- 1 for PIF, N for monthly

  -- Dates (best-effort extraction from recurringServiceDates and top-level fields)
  sale_date              DATE,
  start_date             DATE,
  next_billing_date      DATE,
  cancel_date            DATE,                 -- first non-null of cancellation/termination/end/etc.

  -- Status
  status                 TEXT,                 -- lowercased recurringServiceStatus ('active','cancelled',...)

  -- Employees
  service_employee_id    TEXT,
  service_employee_name  TEXT,                 -- "First Last" or null

  -- ABC metadata
  last_modified_timestamp TIMESTAMPTZ,

  -- Sync metadata
  last_synced_at         TIMESTAMPTZ DEFAULT now(),
  raw                    JSONB,                -- full ABC payload for fields not yet promoted

  PRIMARY KEY (club_number, recurring_service_id)
);

CREATE INDEX IF NOT EXISTS idx_abc_rs_member
  ON abc_recurring_services (club_number, member_id);

CREATE INDEX IF NOT EXISTS idx_abc_rs_status
  ON abc_recurring_services (club_number, status);

CREATE INDEX IF NOT EXISTS idx_abc_rs_last_modified
  ON abc_recurring_services (club_number, last_modified_timestamp);

CREATE INDEX IF NOT EXISTS idx_abc_rs_cancel_date
  ON abc_recurring_services (club_number, cancel_date)
  WHERE cancel_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_abc_rs_sale_date
  ON abc_recurring_services (club_number, sale_date)
  WHERE sale_date IS NOT NULL;
