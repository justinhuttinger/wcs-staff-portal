-- Editable list of ABC membership_type values to exclude from
-- reporting, leaderboards, and GHL reconciliation. Admins manage
-- this list from the portal Admin Panel; both auth API and
-- ghl-sync read from it at runtime.

CREATE TABLE IF NOT EXISTS abc_membership_skip_list (
  membership_type text PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES staff(id) ON DELETE SET NULL,
  note            text
);

INSERT INTO abc_membership_skip_list (membership_type, note) VALUES
  ('CHILDCARE',    'Not a real member — childcare access only'),
  ('Club Access',  'Not a real member — club access only'),
  ('Event Access', 'Not a real member — event access only'),
  ('NON-MEMBER',   'Explicit non-member type'),
  ('NLPT ONLY',    'PT-only — excluded from membership metrics'),
  ('PT ONLY',      'PT-only — excluded from membership metrics'),
  ('SWIM ONLY',    'Swim-only — excluded from membership metrics')
ON CONFLICT (membership_type) DO NOTHING;
