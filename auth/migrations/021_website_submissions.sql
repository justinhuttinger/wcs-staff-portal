-- 021_website_submissions.sql
-- Stores form submissions POSTed from the WCS public website. The auth
-- service exposes POST /webhooks/website-form which url-decodes the body,
-- extracts known fields (name/email/phone/message/opt-in/form_id/form_name),
-- parses the location from the form_name prefix, and inserts one row here.
-- Anything not in the well-known list is preserved verbatim in `raw` JSONB
-- so dynamic "No Label field_*" fields don't get lost.
--
-- No idempotency key: duplicate submissions are legitimate events.

CREATE TABLE IF NOT EXISTS website_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  form_id       text,
  form_name     text,
  location      text,            -- parsed from form_name prefix; null if no match
  first_name    text,
  last_name     text,
  email         text,
  phone         text,
  message       text,
  opt_in        boolean,
  raw           jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_website_submissions_received
  ON website_submissions(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_website_submissions_form_name
  ON website_submissions(form_name, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_website_submissions_location
  ON website_submissions(location, received_at DESC);
