-- 037_marketing_effort_activity.sql
-- Turn marketing_effort_comments into a unified activity feed: human comments
-- plus automatic edit events, ordered together by created_at. `kind` tags the
-- row ('comment' = a written comment, 'edit' = a recorded change). `meta` holds
-- the structured change list for edit rows: { changes: [{ field, action, from,
-- to }] }. body becomes nullable since edit rows carry their detail in meta
-- (a human summary is still stored in body for convenience).

ALTER TABLE marketing_effort_comments
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'comment',
  ADD COLUMN IF NOT EXISTS meta jsonb;

ALTER TABLE marketing_effort_comments
  ALTER COLUMN body DROP NOT NULL;

-- RLS is already enabled on every public table (migration 035, service-role
-- only access); new columns inherit that. No policy change needed.
