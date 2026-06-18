-- 049_university_pending_assignments.sql
--
-- "Prepare" handoff for the inbound dial model. When a rep hits Dial on a GHL
-- contact, a GHL "call started" workflow POSTs that contact's persona to
-- /university/calls/prepare, which writes a short-lived pending row keyed by the
-- caller's phone (the from_number Retell will see). When the call reaches the
-- Retell number, the inbound webhook looks up the pending row by from_number and
-- serves THAT persona (instead of a random one) — and carries contact_id /
-- location_id through so grading can write back to the GHL contact.
--
-- Rows are consumed (consumed_at set) on use and expire via expires_at; a tiny
-- table that stays near-empty in normal operation.
--
-- Service-role-only (RLS on, no policy) per migration 035. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS roleplay_pending_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_phone  text NOT NULL,          -- normalized from_number (the join key)
  trainee_id    text,
  trainee_name  text,
  contact_id    text,                   -- GHL practice contact (enables write-back)
  location_id   text,
  scenario      text NOT NULL,
  difficulty    text NOT NULL,
  call_type     text NOT NULL DEFAULT 'cold_lead',
  lead_source   text,
  consumed_at   timestamptz,            -- set when an inbound call claims it
  expires_at    timestamptz NOT NULL,   -- TTL; ignored once past
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Lookup is "most recent unconsumed, unexpired row for this caller".
CREATE INDEX IF NOT EXISTS idx_pending_lookup
  ON roleplay_pending_assignments (caller_phone, created_at DESC)
  WHERE consumed_at IS NULL;

ALTER TABLE roleplay_pending_assignments ENABLE ROW LEVEL SECURITY;

COMMIT;
