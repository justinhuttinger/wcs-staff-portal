-- Make SMS template identity GLOBAL across locations instead of per-club.
--
-- Justin needs one row per template with cumulative numbers across all seven
-- gyms, plus a per-club breakdown underneath — not seven separate rows for
-- the same fingerprint. sms_templates was keyed on (location, template_key);
-- it is now keyed on template_key alone.
--
-- sms_templates currently holds only one day of disposable test data (this
-- feature has not shipped), so DROP + recreate is the simplest correct move
-- here rather than a fragile ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT
-- dance to repoint the primary key. Do not copy this pattern once the table
-- holds real data — that would need an actual migration of existing rows.
DROP TABLE IF EXISTS sms_templates;

CREATE TABLE sms_templates (
  template_key         TEXT PRIMARY KEY,
  label                 TEXT,             -- human-assigned name, nullable
  sample_body           TEXT NOT NULL,    -- first body seen, for identification
  first_seen_location   TEXT,             -- which club's send first produced this key
  first_seen_at         TIMESTAMPTZ NOT NULL,
  last_seen_at          TIMESTAMPTZ NOT NULL
);

-- Portal DB access is 100% service-role; enable RLS (no policy) on every table.
ALTER TABLE sms_templates ENABLE ROW LEVEL SECURITY;

-- Per-template engagement across ALL locations, for one send-date range, with
-- a per-club breakdown rolled up underneath each template group.
--
-- p_location: location slug to narrow to ONE club, or NULL for all locations.
-- p_kind:     'automated' (workflow + bulk_actions), 'staff' (app), or 'all'.
--
-- Templates are grouped by human label when set (so a relabeled/edited
-- template's several fingerprints roll up together), else by the raw
-- template_key. template_keys carries every fingerprint folded into a group,
-- which is what the label-rename endpoint needs to rename them all at once.
--
-- The range filters the SEND date only. A reply that arrives after p_end still
-- counts, because the attribution window (not the report range) bounds what
-- counts as a reply.
-- CREATE OR REPLACE cannot change a function's return type — migration 015
-- already created this function with a different RETURNS TABLE shape, so
-- Postgres rejects the replace with "cannot change return type of existing
-- function". Drop it first. (Verified: applying without this DROP fails with
-- SQLSTATE 42P13 on any database where 015 has been applied.)
DROP FUNCTION IF EXISTS sms_engagement_by_template(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION sms_engagement_by_template(
  p_location TEXT,
  p_start    TIMESTAMPTZ,
  p_end      TIMESTAMPTZ,
  p_kind     TEXT
)
RETURNS TABLE (
  group_key             TEXT,
  label                 TEXT,
  template_keys         TEXT[],
  clubs                 TEXT[],
  sample_body           TEXT,
  sends                 BIGINT,
  delivered             BIGINT,
  failed                BIGINT,
  replies               BIGINT,
  opt_outs              BIGINT,
  median_reply_minutes  NUMERIC,
  by_club                JSONB
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT
      m.id,
      m.location,
      m.template_key,
      m.status,
      m.body,
      m.date_added,
      t.label,
      COALESCE(t.label, m.template_key) AS group_key,
      r.send_id,
      r.is_opt_out
    FROM ghl_sms_messages m
    LEFT JOIN sms_replies r ON r.send_id = m.id
    LEFT JOIN sms_templates t ON t.template_key = m.template_key
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
  ),
  -- base is already fanned out by its own LEFT JOIN sms_replies (one row per
  -- (send, reply) pair), so re-joining sms_replies here without deduping
  -- would multiply again: a send with N replies would contribute N^2 rows and
  -- bias the median toward heavily-replied sends. DISTINCT on
  -- (group_key, inbound_id, reply_minutes) — inbound_id is sms_replies' own
  -- primary key — collapses that fan-out so each reply is counted exactly
  -- once per group. The median's population is per REPLY, not per send; that
  -- is intended (median time-to-reply across replies).
  reply_times AS (
    SELECT DISTINCT b.group_key, r.inbound_id, r.reply_minutes
    FROM base b
    JOIN sms_replies r ON r.send_id = b.id
  ),
  per_club AS (
    SELECT
      b.group_key,
      b.location,
      -- The LEFT JOIN to sms_replies multiplies a send's row for each reply it
      -- received, so count(*) would over-count sends; count DISTINCT b.id instead.
      count(DISTINCT b.id)                                          AS sends,
      count(DISTINCT b.id) FILTER (WHERE b.status = 'delivered')    AS delivered,
      count(DISTINCT b.id) FILTER (WHERE b.status IN ('failed','undelivered')) AS failed,
      count(DISTINCT b.send_id)                                     AS replies,
      count(DISTINCT b.send_id) FILTER (WHERE b.is_opt_out)         AS opt_outs
    FROM base b
    GROUP BY b.group_key, b.location
  )
  SELECT
    b.group_key,
    max(b.label)                                                    AS label,
    array_agg(DISTINCT b.template_key)                              AS template_keys,
    array_agg(DISTINCT b.location)                                  AS clubs,
    -- max(b.body) sorts by collation, not by recency, so it systematically
    -- surfaced the lexicographically-largest member name in the cluster
    -- (live data: a Cyrillic name). Pick the earliest send's body instead,
    -- matching what sms_templates.sample_body already claims to be ("first
    -- body seen") and stable across refetches.
    (
      SELECT b2.body FROM base b2
      WHERE b2.group_key = b.group_key
      ORDER BY b2.date_added, b2.id
      LIMIT 1
    )                                                                AS sample_body,
    count(DISTINCT b.id)                                            AS sends,
    count(DISTINCT b.id) FILTER (WHERE b.status = 'delivered')      AS delivered,
    count(DISTINCT b.id) FILTER (WHERE b.status IN ('failed','undelivered')) AS failed,
    count(DISTINCT b.send_id)                                       AS replies,
    count(DISTINCT b.send_id) FILTER (WHERE b.is_opt_out)           AS opt_outs,
    -- percentile_cont over an integer column resolves to double precision, but
    -- this function declares median_reply_minutes NUMERIC; cast explicitly
    -- rather than rely on an assignment-context cast at CREATE FUNCTION time.
    (
      SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY rt.reply_minutes))::numeric
      FROM reply_times rt
      WHERE rt.group_key = b.group_key
    )                                                                AS median_reply_minutes,
    (
      SELECT jsonb_object_agg(
        pc.location,
        jsonb_build_object(
          'sends', pc.sends,
          'delivered', pc.delivered,
          'failed', pc.failed,
          'replies', pc.replies,
          'opt_outs', pc.opt_outs
        )
      )
      FROM per_club pc
      WHERE pc.group_key = b.group_key
    )                                                                AS by_club
  FROM base b
  GROUP BY b.group_key
  -- Tiebreaker on group_key: equal-send groups otherwise have no defined
  -- order and can silently reorder between refetches, making rows appear to
  -- jump around after an unrelated rename.
  ORDER BY count(DISTINCT b.id) DESC, b.group_key;
$$;
