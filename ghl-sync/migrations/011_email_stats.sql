-- Email campaign performance from GHL Email Statistics V2.
-- One row per send: (location, GHL sourceId). Three campaign sources are pulled
-- per location and stored under one table, tagged by `source`:
--   email-campaigns | bulk-actions | workflow-campaigns
-- Populated by src/sync/emailStatsSync.js. Rates are GHL-precomputed and stored
-- as-is (not recomputed) so the sent-vs-delivered denominator is GHL's own math.
CREATE TABLE IF NOT EXISTS email_stats (
  location          TEXT NOT NULL,   -- location slug (e.g. 'springfield')
  location_id       TEXT,            -- GHL sub-account id
  source            TEXT NOT NULL,   -- email-campaigns | bulk-actions | workflow-campaigns
  source_id         TEXT NOT NULL,   -- GHL sourceId (the stats identifier)
  campaign_id       TEXT,            -- GHL record id (distinct from sourceId)
  name              TEXT,
  subject           TEXT,
  status            TEXT,
  schedule_type     TEXT,
  completed_at      TIMESTAMPTZ,
  created_at_ghl    TIMESTAMPTZ,
  updated_at_ghl    TIMESTAMPTZ,
  sent              INTEGER DEFAULT 0,
  accepted          INTEGER DEFAULT 0,
  delivered         INTEGER DEFAULT 0,
  opened            INTEGER DEFAULT 0,
  clicked           INTEGER DEFAULT 0,
  unsubscribed      INTEGER DEFAULT 0,
  complained        INTEGER DEFAULT 0,
  permanent_fail    INTEGER DEFAULT 0,
  temporary_fail    INTEGER DEFAULT 0,
  rejected          INTEGER DEFAULT 0,
  failed            INTEGER DEFAULT 0,
  replied           INTEGER DEFAULT 0,
  open_rate         NUMERIC DEFAULT 0,
  click_rate        NUMERIC DEFAULT 0,
  unsubscribe_rate  NUMERIC DEFAULT 0,
  complaint_rate    NUMERIC DEFAULT 0,
  bounce_rate       NUMERIC DEFAULT 0,
  reply_rate        NUMERIC DEFAULT 0,
  synced_at         TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (location, source_id)
);

CREATE INDEX IF NOT EXISTS idx_email_stats_location ON email_stats (location);
CREATE INDEX IF NOT EXISTS idx_email_stats_completed_at ON email_stats (completed_at DESC);

-- Portal DB access is 100% service-role; enable RLS (no policy) on every table.
ALTER TABLE email_stats ENABLE ROW LEVEL SECURITY;
