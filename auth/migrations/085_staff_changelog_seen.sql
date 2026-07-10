-- 085_staff_changelog_seen.sql
-- Per-user "What's New" read state. Stores the highest changelog entry id each
-- staff member has seen, so the unread badge follows them across devices
-- (replacing the per-browser localStorage approach).

CREATE TABLE IF NOT EXISTS staff_changelog_seen (
  staff_id     uuid PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  last_seen_id integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE staff_changelog_seen ENABLE ROW LEVEL SECURITY;
