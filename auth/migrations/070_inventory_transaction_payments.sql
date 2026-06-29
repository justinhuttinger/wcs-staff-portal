-- auth/migrations/070_inventory_transaction_payments.sql
-- Per-line POS payment tenders, dropped by the original sync mapper but
-- retained in inventory_transactions.raw. Enables cash-vs-card reconciliation
-- for the Till tracking system.
CREATE TABLE IF NOT EXISTS inventory_transaction_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_pk   uuid NOT NULL REFERENCES inventory_transactions(id) ON DELETE CASCADE,
  club_number      text NOT NULL,
  line_no          integer NOT NULL,
  pay_no           integer NOT NULL,           -- index within the line's payments[]
  payment_type     text,                       -- raw ABC value, e.g. "Visa(xxxx6263)"
  payment_amount   numeric(12,2),
  payment_tax      numeric(12,2),
  tender_category  text NOT NULL,              -- cash|card|check|account|writeoff|other
  UNIQUE (transaction_pk, line_no, pay_no)
);

CREATE INDEX IF NOT EXISTS idx_inv_txn_pay_txn
  ON inventory_transaction_payments(transaction_pk);
CREATE INDEX IF NOT EXISTS idx_inv_txn_pay_club_tender
  ON inventory_transaction_payments(club_number, tender_category);

ALTER TABLE inventory_transaction_payments ENABLE ROW LEVEL SECURITY;
