-- 012_shared_credentials.sql
-- Master credentials that apply to all staff for a given service
-- (e.g. trainerize, mycoke, sportlifedistribution). Returned from
-- /vault/credentials when no per-staff credential exists for that service,
-- so the launcher's existing auto-fill picks them up automatically.

CREATE TABLE IF NOT EXISTS shared_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL UNIQUE,
  encrypted_username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_credentials_service ON shared_credentials(service);

COMMENT ON TABLE shared_credentials IS 'Master credentials that apply to all staff for a given service. Returned from /vault/credentials when no per-staff credential exists for that service.';
