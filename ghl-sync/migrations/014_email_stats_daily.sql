-- Daily cumulative snapshots of GHL email campaign stats.
--
-- Why this exists: GHL's workflow-campaign stats endpoint returns LIFETIME
-- totals with no date dimension. email_stats holds the current lifetime value
-- and is overwritten each sync, so a date range over it is impossible for
-- workflows. This table keeps one frozen copy per campaign per day; a period
-- figure is (snapshot on/before end) - (snapshot before start).
--
-- Written by src/sync/emailStatsSync.js alongside the email_stats upsert.
-- Re-running the sync on the same day overwrites that day's row, so the last
-- run of the day wins. Counters only, no rates: rates are recomputed from the
-- diffed counters (a lifetime rate is meaningless for a period).
CREATE TABLE IF NOT EXISTS email_stats_daily (
  location        TEXT NOT NULL,   -- location slug (e.g. 'springfield')
  source          TEXT NOT NULL,   -- email-campaigns | bulk-actions | workflow-campaigns
  source_id       TEXT NOT NULL,   -- GHL sourceId
  snapshot_date   DATE NOT NULL,   -- UTC date the snapshot was taken
  name            TEXT,
  subject         TEXT,
  sent            INTEGER NOT NULL DEFAULT 0,
  accepted        INTEGER NOT NULL DEFAULT 0,
  delivered       INTEGER NOT NULL DEFAULT 0,
  opened          INTEGER NOT NULL DEFAULT 0,
  clicked         INTEGER NOT NULL DEFAULT 0,
  unsubscribed    INTEGER NOT NULL DEFAULT 0,
  complained      INTEGER NOT NULL DEFAULT 0,
  permanent_fail  INTEGER NOT NULL DEFAULT 0,
  temporary_fail  INTEGER NOT NULL DEFAULT 0,
  rejected        INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  replied         INTEGER NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (location, source_id, snapshot_date)
);

-- The report reads "latest snapshot on or before date X" per campaign, so the
-- descending date order is the hot path.
CREATE INDEX IF NOT EXISTS idx_email_stats_daily_lookup
  ON email_stats_daily (location, source, source_id, snapshot_date DESC);

-- Portal DB access is 100% service-role; enable RLS (no policy) on every table.
ALTER TABLE email_stats_daily ENABLE ROW LEVEL SECURITY;
