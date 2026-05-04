-- 010_align_roles.sql
-- Align the database with the canonical ROLE_HIERARCHY used by the
-- middleware and the admin UI: ['team_member', 'lead', 'manager',
-- 'corporate', 'admin'].
--
-- What was wrong (as of 2026-05-04):
--   * staff_role_check allowed ('team_member', 'fd_lead', 'pt_lead',
--     'manager', 'corporate', 'admin') but the codebase only ever writes
--     'lead'. Any update with role='lead' was rejected by Postgres and
--     surfaced as a generic 500 from PUT /admin/staff/:id.
--   * role_tool_visibility only had rows for 'admin' and 'manager'.
--     team_member / lead / corporate had no rows at all, so the admin
--     "Roles" tab couldn't toggle visibility for those tiers.
--
-- This migration is idempotent.

BEGIN;

-- 1) Drop both check constraints up front so the data migration below has
--    room to insert/update rows with canonical values (the old constraints
--    rejected 'team_member', 'corporate', etc.).
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff DROP CONSTRAINT IF EXISTS role_check;
ALTER TABLE role_tool_visibility DROP CONSTRAINT IF EXISTS role_tool_visibility_role_check;

-- 2) Migrate any legacy role values on staff (no-ops if already canonical).
UPDATE staff SET role = 'team_member' WHERE role IN ('front_desk', 'personal_trainer');
UPDATE staff SET role = 'corporate'   WHERE role = 'director';
UPDATE staff SET role = 'lead'        WHERE role IN ('fd_lead', 'pt_lead');

-- 3) Same data-cleanup on role_tool_visibility for older environments.
INSERT INTO role_tool_visibility (role, tool_key, visible)
  SELECT 'team_member', tool_key, bool_or(visible)
    FROM role_tool_visibility
    WHERE role IN ('front_desk', 'personal_trainer')
    GROUP BY tool_key
ON CONFLICT (role, tool_key) DO NOTHING;

INSERT INTO role_tool_visibility (role, tool_key, visible)
  SELECT 'corporate', tool_key, visible
    FROM role_tool_visibility
    WHERE role = 'director'
ON CONFLICT (role, tool_key) DO NOTHING;

INSERT INTO role_tool_visibility (role, tool_key, visible)
  SELECT 'lead', tool_key, bool_or(visible)
    FROM role_tool_visibility
    WHERE role IN ('fd_lead', 'pt_lead')
    GROUP BY tool_key
ON CONFLICT (role, tool_key) DO NOTHING;

DELETE FROM role_tool_visibility
  WHERE role IN ('front_desk', 'personal_trainer', 'director', 'fd_lead', 'pt_lead');

-- 4) Seed visibility rows (visible=true) for any (role, tool_key) pair that
--    currently has no row at all. We use the union of every tool_key already
--    in the table as the "known tools" set, so we don't have to hardcode them.
INSERT INTO role_tool_visibility (role, tool_key, visible)
  SELECT r.role, t.tool_key, true
    FROM (VALUES ('team_member'), ('lead'), ('manager'), ('corporate'), ('admin'))
         AS r(role)
    CROSS JOIN (SELECT DISTINCT tool_key FROM role_tool_visibility) AS t
ON CONFLICT (role, tool_key) DO NOTHING;

-- 5) Re-add canonical CHECK constraints on both tables.
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('team_member', 'lead', 'manager', 'corporate', 'admin'));
ALTER TABLE role_tool_visibility ADD CONSTRAINT role_tool_visibility_role_check
  CHECK (role IN ('team_member', 'lead', 'manager', 'corporate', 'admin'));

COMMIT;
