-- Payroll report tables.
--
-- Two sources of commission data:
--   1. Sales commissions per (club, employee, profit_center, period) — comes
--      from the monthly CSV emailed by ABC. Loaded manually for now; future
--      ingestion via portal upload or SendGrid Inbound Parse.
--   2. Recurring-service commissions — synced from ABC /members/recurringservices
--      filtered by saleTimestampRange. 4% of total contract value.
--
-- Trainer session counts come from abc_calendar_events (already in place).

CREATE TABLE IF NOT EXISTS payroll_sales_commissions (
  id              BIGSERIAL PRIMARY KEY,
  period          DATE NOT NULL,                 -- first day of the month the row covers
  club_number     TEXT NOT NULL,
  employee_name   TEXT NOT NULL,                 -- raw from CSV
  profit_center   TEXT NOT NULL,                 -- "WCS Drinks", "WCS Snacks", "TRAINING", etc
  commission      NUMERIC(12,2) NOT NULL,
  source          TEXT,                          -- 'csv_upload', 'email', 'manual'
  uploaded_by     TEXT,
  uploaded_at     TIMESTAMPTZ DEFAULT now(),
  raw             JSONB,
  UNIQUE (period, club_number, employee_name, profit_center)
);

CREATE INDEX IF NOT EXISTS payroll_sales_period_club ON payroll_sales_commissions (period, club_number);
CREATE INDEX IF NOT EXISTS payroll_sales_employee   ON payroll_sales_commissions (employee_name);

CREATE TABLE IF NOT EXISTS payroll_recurring_commissions (
  recurring_service_id     TEXT NOT NULL,
  club_number              TEXT NOT NULL,
  period                   DATE NOT NULL,         -- first day of the month the SALE happened in
  sale_date                DATE,
  member_id                TEXT,
  member_name              TEXT,
  employee_id              TEXT,                  -- commission recipient: commissionsEmployeeIds[0] from ABC (falls back to serviceEmployeeId)
  employee_name            TEXT,
  service_item             TEXT,                  -- e.g. "PT 60MIN"
  recurring_type_desc      TEXT,                  -- "Paid in Full" / "Recurring" / etc
  invoice_total            NUMERIC(12,2),         -- per-invoice amount
  total_periods            INTEGER,               -- 1 for PIF, N for monthly etc
  total_contract_value     NUMERIC(12,2),         -- invoice_total * max(total_periods, 1)
  commission_rate          NUMERIC(5,4) DEFAULT 0.04,
  commission               NUMERIC(12,2),         -- total_contract_value * commission_rate
  fetched_at               TIMESTAMPTZ DEFAULT now(),
  raw                      JSONB,
  PRIMARY KEY (club_number, recurring_service_id)
);

CREATE INDEX IF NOT EXISTS payroll_recurring_period_club ON payroll_recurring_commissions (period, club_number);
CREATE INDEX IF NOT EXISTS payroll_recurring_employee    ON payroll_recurring_commissions (employee_name);
