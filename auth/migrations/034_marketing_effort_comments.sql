-- 034_marketing_effort_comments.sql
-- Threaded comments on a marketing effort. Each comment records the staff
-- member who wrote it (id + display name snapshot). Comments cascade-delete
-- with their parent effort.

CREATE TABLE IF NOT EXISTS marketing_effort_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effort_id       uuid NOT NULL REFERENCES marketing_efforts(id) ON DELETE CASCADE,
  body            text NOT NULL,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_effort_comments_effort
  ON marketing_effort_comments(effort_id, created_at);
