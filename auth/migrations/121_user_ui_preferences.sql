-- 121_user_ui_preferences.sql
-- Per-user portal appearance + pinned shortcuts, so both follow a person across
-- devices instead of living in one browser's localStorage.
--
-- This is the table the Spotlight appearance work scoped and never built
-- (see AppearanceAdmin / lib/theme.js). Same shape and same reasoning as
-- migration 085's staff_changelog_seen: one row per staff member, replacing a
-- per-browser store.
--
-- Everything lives in a single jsonb blob rather than a column per preference.
-- These are display choices with no server-side meaning — nothing joins or
-- filters on them — and the set changes every time the theme grows an option.
-- A column per preference would mean a migration for each one.
--
-- The client still mirrors to localStorage: it is what paints before the first
-- API round-trip (index.html reads it pre-paint to avoid a flash of Classic)
-- and what keeps someone's bar intact if the API is unreachable mid-shift.

CREATE TABLE IF NOT EXISTS user_ui_preferences (
  staff_id   uuid PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Portal DB is service-role only; RLS on with no policy denies anon/authenticated
-- outright while the service key continues to bypass it.
ALTER TABLE user_ui_preferences ENABLE ROW LEVEL SECURITY;
