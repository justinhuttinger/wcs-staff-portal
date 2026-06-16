-- 043_marketing_needs_research.sql
-- Two new Marketing Tracker tabs alongside the existing effort tracker:
--   * Needs List — requests for graphic design / media / print / etc.
--   * Research   — AI (web-search) findings of local events/opportunities to
--                  participate in, which can be pushed into the tracker or needs.

CREATE TABLE IF NOT EXISTS marketing_needs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  kind            text NOT NULL DEFAULT 'other',  -- graphic_design | media | print | social | web | other
  description     text,
  status          text NOT NULL DEFAULT 'open',   -- open | in_progress | done
  priority        text NOT NULL DEFAULT 'normal', -- low | normal | high
  locations       text[] NOT NULL DEFAULT '{}',   -- location slugs ([] = all/corporate)
  due_date        date,
  assignee_name   text,
  requested_by    uuid,
  requested_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_needs_status ON marketing_needs(status, created_at DESC);

-- One row per AI-surfaced opportunity. A single "run" inserts many rows sharing
-- a run_id so the UI can group them.
CREATE TABLE IF NOT EXISTS marketing_research (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid,
  location        text NOT NULL,                  -- location slug or 'all'
  title           text NOT NULL,
  event_date      text,                           -- free text — events list dates many ways
  category        text,                           -- festival | race | market | sponsorship | community | other
  description     text,
  relevance       text,                           -- why a gym should participate
  url             text,
  status          text NOT NULL DEFAULT 'new',    -- new | saved | dismissed | added
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_research_loc ON marketing_research(location, created_at DESC);

-- Reuse the marketing touch trigger fn if present; else create a local one.
CREATE OR REPLACE FUNCTION marketing_needs_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_marketing_needs_updated_at ON marketing_needs;
CREATE TRIGGER trg_marketing_needs_updated_at
  BEFORE UPDATE ON marketing_needs
  FOR EACH ROW EXECUTE FUNCTION marketing_needs_touch_updated_at();

-- Service-role only (RLS on, no policy) — matches migration 035 convention.
ALTER TABLE marketing_needs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_research ENABLE ROW LEVEL SECURITY;
