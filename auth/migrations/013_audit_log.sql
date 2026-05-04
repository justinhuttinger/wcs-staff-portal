-- 013_audit_log.sql
-- Per-staff activity stream. Captures sessions (login/logout), page/view
-- opens, and explicit actions. Written fire-and-forget from the portal
-- and launcher; queried by admins via Admin Panel -> Activity.

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  target TEXT,
  metadata JSONB,
  hostname TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_staff_created ON audit_log(staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_type_created ON audit_log(event_type, created_at DESC);
