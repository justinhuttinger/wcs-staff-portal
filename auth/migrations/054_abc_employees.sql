-- ABC employee directory: maps an ABC employeeId (the GUID that rides POS
-- transactions) to a human name. POS sales only carry the GUID, and the old
-- name lookup (abc_calendar_events) only knew employees who book appointments,
-- so most cashiers showed as "ABC POS". ABC's /{club}/employees endpoint is the
-- authoritative source (resolves ~94% of POS transactions), synced here daily.

CREATE TABLE IF NOT EXISTS abc_employees (
  employee_id   text PRIMARY KEY,           -- ABC employeeId GUID (matches POS employee_id)
  first_name    text,
  last_name     text,
  full_name     text,                       -- precomputed "First Last" for display
  position      text,
  department    text,
  status        text,                       -- ABC employeeStatus (active/inactive/...)
  club_number   text,                       -- most-recently-seen home club
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Service-role only access (frontend never touches this); RLS on, no policy.
ALTER TABLE abc_employees ENABLE ROW LEVEL SECURITY;
