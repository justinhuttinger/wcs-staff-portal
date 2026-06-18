-- 047_wcs_university.sql
--
-- WCS University — voice roleplay sales training.
--
-- A trainee places a "call" from GoHighLevel and is connected to a Retell AI
-- agent role-playing a prospective gym member. After the call, the transcript
-- is graded by an LLM against the WCS 7-stage sales pipeline, scores land here,
-- and a lightweight summary is mirrored back onto the GHL contact.
--
-- Design (spec §9.1): Supabase is the authoritative ledger; GHL custom fields
-- are the visible mirror. Graduation eligibility is computed here from the
-- ledger against milestone_config, then mirrored to GHL.
--
-- Tables:
--   roleplay_sessions    one row per "call" (initiated -> completed -> graded)
--   roleplay_grades      one row per graded transcript (per-stage scores)
--   trainee_milestones   per-trainee/per-milestone ledger (curriculum + competency)
--   trainee_graduation   computed rollup mirrored to GHL
--   milestone_config     single-row JSONB config (pass thresholds + required set)
--
-- Service-role-only access (RLS on, no policy) — matches migration 035. The
-- portal backend reaches these with the service-role key; the frontend never
-- touches them directly.
--
-- This migration is idempotent.

BEGIN;

-- updated_at touch helper, scoped to this feature (mirrors inventory_touch_updated_at).
CREATE OR REPLACE FUNCTION university_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- roleplay_sessions — one row per call attempt.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roleplay_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id      text NOT NULL,            -- GHL user id or internal staff id
  trainee_name    text,
  trainee_phone   text,
  contact_id      text,                     -- GHL practice/persona contact id
  location_id     text,                     -- GHL location id (for write-back)
  scenario        text NOT NULL,            -- e.g. price_sensitive_snapchat
  difficulty      text NOT NULL,            -- easy | medium | hard
  retell_agent_id text,
  retell_call_id  text,                     -- set after Retell create-call returns
  status          text NOT NULL DEFAULT 'initiated', -- initiated | completed | graded | failed
  transcript      text,
  recording_url   text,
  call_analysis   jsonb,                    -- raw Retell call_analysis, if provided
  error_detail    text,                     -- populated on status='failed'
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_trainee   ON roleplay_sessions(trainee_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_status    ON roleplay_sessions(status);
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_call_id   ON roleplay_sessions(retell_call_id);

DROP TRIGGER IF EXISTS trg_roleplay_sessions_updated_at ON roleplay_sessions;
CREATE TRIGGER trg_roleplay_sessions_updated_at
  BEFORE UPDATE ON roleplay_sessions
  FOR EACH ROW EXECUTE FUNCTION university_touch_updated_at();

-- ---------------------------------------------------------------------------
-- roleplay_grades — one row per graded transcript.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roleplay_grades (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES roleplay_sessions(id) ON DELETE CASCADE,
  trainee_id       text NOT NULL,
  overall_score    numeric,        -- 0-100
  stage_scores     jsonb,          -- per-dimension rubric scores
  strengths        text,
  improvements     text,
  raw_model_output jsonb,          -- full parsed model response for audit
  model            text,           -- model id used to grade
  graded_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roleplay_grades_session ON roleplay_grades(session_id);
CREATE INDEX IF NOT EXISTS idx_roleplay_grades_trainee ON roleplay_grades(trainee_id, graded_at DESC);

-- ---------------------------------------------------------------------------
-- trainee_milestones — per-trainee/per-milestone ledger (one row per pair).
-- Curriculum = "did the thing"; competency = "did it well enough" (score-gated).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trainee_milestones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id        text NOT NULL,
  milestone_key     text NOT NULL,        -- e.g. roleplay_hard, mod1, objection_handling
  milestone_type    text NOT NULL,        -- curriculum | competency
  passed            boolean NOT NULL DEFAULT false,
  best_score        numeric,              -- highest score seen for this milestone
  attempts          int NOT NULL DEFAULT 0,
  passed_session_id uuid REFERENCES roleplay_sessions(id) ON DELETE SET NULL,
  first_attempt_at  timestamptz,
  passed_at         timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trainee_id, milestone_key)
);

CREATE INDEX IF NOT EXISTS idx_trainee_milestones_trainee ON trainee_milestones(trainee_id);

DROP TRIGGER IF EXISTS trg_trainee_milestones_updated_at ON trainee_milestones;
CREATE TRIGGER trg_trainee_milestones_updated_at
  BEFORE UPDATE ON trainee_milestones
  FOR EACH ROW EXECUTE FUNCTION university_touch_updated_at();

-- ---------------------------------------------------------------------------
-- trainee_graduation — computed rollup, mirrored to GHL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trainee_graduation (
  trainee_id           text PRIMARY KEY,
  progress_pct         numeric NOT NULL DEFAULT 0,
  eligible             boolean NOT NULL DEFAULT false,
  required_milestones  jsonb,             -- snapshot of what was required at eval time
  completed_milestones jsonb,
  evaluated_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- milestone_config — single-row config (spec §9.6). Editable without redeploy.
-- The service reads the row where id = true; that CHECK guarantees one row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS milestone_config (
  id          boolean PRIMARY KEY DEFAULT true,
  config      jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  CONSTRAINT milestone_config_singleton CHECK (id = true)
);

DROP TRIGGER IF EXISTS trg_milestone_config_updated_at ON milestone_config;
CREATE TRIGGER trg_milestone_config_updated_at
  BEFORE UPDATE ON milestone_config
  FOR EACH ROW EXECUTE FUNCTION university_touch_updated_at();

-- Seed the default config (placeholder thresholds from spec §9.6). ON CONFLICT
-- DO NOTHING keeps re-runs from clobbering a tuned config.
INSERT INTO milestone_config (id, config) VALUES (true, '{
  "pass_threshold_default": 80,
  "milestones": [
    { "key": "mod1",              "type": "curriculum", "required": true },
    { "key": "first_call_made",   "type": "curriculum", "required": true },
    { "key": "roleplay_easy",     "type": "competency", "required": true, "pass_threshold": 75 },
    { "key": "roleplay_medium",   "type": "competency", "required": true, "pass_threshold": 80 },
    { "key": "roleplay_hard",     "type": "competency", "required": true, "pass_threshold": 85 },
    { "key": "objection_handling","type": "competency", "required": true, "pass_threshold": 80 }
  ]
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS: service-role-only (on, no policy) — matches migration 035.
-- ---------------------------------------------------------------------------
ALTER TABLE roleplay_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_grades     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainee_milestones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainee_graduation  ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestone_config    ENABLE ROW LEVEL SECURITY;

COMMIT;
