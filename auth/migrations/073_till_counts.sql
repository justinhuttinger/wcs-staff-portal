-- auth/migrations/073_till_counts.sql
-- Physical drawer counts parsed from Operandio "Drawer Open/Close Count" jobs.
-- The Operandio job is a per-denomination breakdown (# of $100s, $20s, ... pennies),
-- so counted_amount is the denomination-weighted total (sum of count*denomination)
-- and denominations is { "<denomination_in_dollars>": <count> }, e.g. {"100":1,"0.25":8}.
-- One open + one close per club per business day (the unique key collapses re-sends).
-- Number is 073 (not 072): master tops at 069; 070=inventory_transaction_payments,
-- 071=till_settings (this branch), 072=print_system (feat/till-receipt-print).
CREATE TABLE IF NOT EXISTS till_counts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_number     text NOT NULL,
  location_slug   text NOT NULL,
  business_date   date NOT NULL,
  count_type      text NOT NULL CHECK (count_type IN ('open','close')),
  counted_amount  numeric(12,2) NOT NULL,
  denominations   jsonb,
  employee_name   text,
  counted_at      timestamptz,
  raw_email_id    uuid,
  source          text NOT NULL DEFAULT 'operandio',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_number, business_date, count_type)
);
CREATE INDEX IF NOT EXISTS idx_till_counts_club_date ON till_counts(club_number, business_date);
ALTER TABLE till_counts ENABLE ROW LEVEL SECURITY;
