-- Per-staff Google OAuth tokens (used by /reports/payroll/export-sheet
-- and other future Sheets/Drive integrations that should run as the
-- requesting user, not a shared org account).
CREATE TABLE IF NOT EXISTS staff_google_tokens (
  staff_id UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  scope TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION staff_google_tokens_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS staff_google_tokens_updated_at ON staff_google_tokens;
CREATE TRIGGER staff_google_tokens_updated_at
  BEFORE UPDATE ON staff_google_tokens
  FOR EACH ROW EXECUTE FUNCTION staff_google_tokens_set_updated_at();
