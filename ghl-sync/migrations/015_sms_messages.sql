-- SMS engagement: per-message store, template clustering, and reply linkage.
--
-- GHL puts no workflow id on a message, so an automated text's only identity is
-- its body. ghl_sms_messages.template_key is a fingerprint of the normalized
-- body (see src/sms/templateKey.js); sms_templates lets a human name a cluster.
-- sms_replies links an inbound message to the send it answered, computed at
-- sync time by src/sms/replyAttribution.js.
--
-- Populated by src/sync/smsStatsSync.js and scripts/backfillSmsMessages.js.

CREATE TABLE IF NOT EXISTS ghl_sms_messages (
  id               TEXT PRIMARY KEY,   -- GHL message id
  location         TEXT NOT NULL,      -- location slug
  location_id      TEXT NOT NULL,      -- GHL sub-account id
  conversation_id  TEXT NOT NULL,
  contact_id       TEXT,
  direction        TEXT NOT NULL,      -- inbound | outbound
  source           TEXT,               -- workflow | bulk_actions | app | null
  status           TEXT,               -- delivered | failed | undelivered | ...
  body             TEXT,
  template_key     TEXT,               -- outbound only; null for inbound
  date_added       TIMESTAMPTZ NOT NULL,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_loc_date ON ghl_sms_messages (location, date_added DESC);
-- Attribution reloads one contact's window at a time.
CREATE INDEX IF NOT EXISTS idx_sms_messages_contact_date ON ghl_sms_messages (contact_id, date_added);
-- The report groups sends by template within a location and date range.
CREATE INDEX IF NOT EXISTS idx_sms_messages_template ON ghl_sms_messages (location, template_key, date_added DESC);

CREATE TABLE IF NOT EXISTS sms_templates (
  location       TEXT NOT NULL,
  template_key   TEXT NOT NULL,
  label          TEXT,                 -- human-assigned name, nullable
  sample_body    TEXT NOT NULL,        -- first body seen, for identification
  first_seen_at  TIMESTAMPTZ NOT NULL,
  last_seen_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (location, template_key)
);

CREATE TABLE IF NOT EXISTS sms_replies (
  inbound_id     TEXT PRIMARY KEY,     -- the inbound message that replied
  send_id        TEXT NOT NULL,        -- the outbound send it answered
  location       TEXT NOT NULL,
  reply_minutes  INTEGER NOT NULL,
  is_opt_out     BOOLEAN NOT NULL DEFAULT false,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One replied send may have several inbound rows; the report counts DISTINCT
-- send_id, so this index carries that grouping.
CREATE INDEX IF NOT EXISTS idx_sms_replies_send ON sms_replies (send_id);

ALTER TABLE ghl_sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_replies ENABLE ROW LEVEL SECURITY;

-- Per-template engagement for one location and send-date range.
--
-- p_location: location slug, or NULL for all locations.
-- p_kind:     'automated' (workflow + bulk_actions), 'staff' (app), or 'all'.
--
-- The range filters the SEND date only. A reply that arrives after p_end still
-- counts, because the attribution window (not the report range) bounds what
-- counts as a reply.
CREATE OR REPLACE FUNCTION sms_engagement_by_template(
  p_location TEXT,
  p_start    TIMESTAMPTZ,
  p_end      TIMESTAMPTZ,
  p_kind     TEXT
)
RETURNS TABLE (
  location              TEXT,
  template_key          TEXT,
  label                 TEXT,
  sample_body           TEXT,
  sends                 BIGINT,
  delivered             BIGINT,
  failed                BIGINT,
  replies               BIGINT,
  opt_outs              BIGINT,
  median_reply_minutes  NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.location,
    m.template_key,
    max(t.label)                                              AS label,
    max(t.sample_body)                                        AS sample_body,
    count(*)                                                  AS sends,
    count(*) FILTER (WHERE m.status = 'delivered')            AS delivered,
    count(*) FILTER (WHERE m.status IN ('failed','undelivered')) AS failed,
    count(DISTINCT r.send_id)                                 AS replies,
    count(DISTINCT r.send_id) FILTER (WHERE r.is_opt_out)     AS opt_outs,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY r.reply_minutes) AS median_reply_minutes
  FROM ghl_sms_messages m
  LEFT JOIN sms_replies r ON r.send_id = m.id
  LEFT JOIN sms_templates t
    ON t.location = m.location AND t.template_key = m.template_key
  WHERE m.direction = 'outbound'
    AND m.template_key IS NOT NULL
    AND (p_location IS NULL OR m.location = p_location)
    AND (p_start IS NULL OR m.date_added >= p_start)
    AND (p_end   IS NULL OR m.date_added <= p_end)
    AND (
      p_kind = 'all'
      OR (p_kind = 'automated' AND m.source IN ('workflow','bulk_actions'))
      OR (p_kind = 'staff'     AND m.source = 'app')
    )
  GROUP BY m.location, m.template_key
  HAVING count(*) > 0
  ORDER BY count(*) DESC;
$$;
