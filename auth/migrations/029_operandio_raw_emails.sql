-- 029_operandio_raw_emails.sql
-- Staging table for Operandio emails the /operandio/webhook parser does not
-- recognize yet (per-submission, overdue, and late-turn-in triggers). The
-- webhook stashes the raw subject + plain-text body here instead of dropping
-- them, so real samples accumulate and parsers for the new event types can be
-- built from actual data. Rows are marked processed once a parser handles
-- their shape.
--
-- No idempotency key: SendGrid retries are rare and duplicates are harmless
-- in a staging table.

CREATE TABLE IF NOT EXISTS operandio_raw_emails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  subject       text,
  from_email    text,
  body_text     text,            -- plain-text part, capped at 100KB by the webhook
  reason        text NOT NULL,   -- subject_unrecognized | no_location_rows
  processed     boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_operandio_raw_emails_received
  ON operandio_raw_emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_operandio_raw_emails_unprocessed
  ON operandio_raw_emails(processed, received_at DESC);
