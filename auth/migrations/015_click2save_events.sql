-- 015_click2save_events.sql
-- Stores Click2Save (CANCEL/FREEZE/OFFER) webhook events forwarded from
-- the prospects---documents Render service. The forwarder fires after
-- Click2Save signature/timestamp/payload validation, so every row here
-- represents an authenticated, well-formed event. Idempotent on
-- request_id (Click2Save retries are deduped by upsert).

CREATE TABLE IF NOT EXISTS click2save_events (
  request_id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL,                    -- CANCEL | FREEZE | OFFER
  occurred_at TIMESTAMPTZ,                       -- from event.occurredAt
  producer TEXT,                                 -- usually "click2save"
  club_code TEXT,                                -- from event.data.clubCode (matches clubs.club_number after lookup)
  member_id TEXT,                                -- ABC member ID
  member_email TEXT,
  member_barcode TEXT,
  agreement_id TEXT,
  result_status TEXT,                            -- e.g. "completed", "REJECTED"
  event_data JSONB NOT NULL,                     -- full original event for forensic queries
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_click2save_events_received ON click2save_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_click2save_events_club_received ON click2save_events(club_code, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_click2save_events_type_received ON click2save_events(request_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_click2save_events_member ON click2save_events(member_id);
