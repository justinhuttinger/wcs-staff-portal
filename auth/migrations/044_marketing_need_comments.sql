-- 044_marketing_need_comments.sql
-- Give Needs List requests the same activity feed as marketing efforts:
-- comments + edit history (who changed what, who commented).

CREATE TABLE IF NOT EXISTS marketing_need_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  need_id         uuid NOT NULL REFERENCES marketing_needs(id) ON DELETE CASCADE,
  body            text,
  kind            text NOT NULL DEFAULT 'comment',  -- comment | edit
  meta            jsonb,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_need_comments_need
  ON marketing_need_comments(need_id, created_at);

ALTER TABLE marketing_need_comments ENABLE ROW LEVEL SECURITY;
