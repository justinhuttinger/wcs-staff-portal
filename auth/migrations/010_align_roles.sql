-- 010_align_roles.sql
-- Consolidate legacy role values to the canonical ROLE_HIERARCHY:
--   ['team_member', 'lead', 'manager', 'corporate', 'admin']
--
-- Legacy → canonical mapping:
--   front_desk        -> team_member
--   personal_trainer  -> team_member
--   director          -> corporate
--
-- This migration is idempotent and safe to re-run.

BEGIN;

-- 1) Temporarily widen the CHECK constraint so the UPDATEs below don't trip on it.
--    We don't know the original constraint name (Supabase auto-generates), so we drop
--    the most likely candidates and add a permissive one we control.
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff DROP CONSTRAINT IF EXISTS role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('team_member', 'lead', 'manager', 'corporate', 'admin',
                  'front_desk', 'personal_trainer', 'director'));

-- 2) Migrate role values on the staff table.
UPDATE staff SET role = 'team_member' WHERE role IN ('front_desk', 'personal_trainer');
UPDATE staff SET role = 'corporate'   WHERE role = 'director';

-- 3) Migrate role_tool_visibility rows.
--    Insert canonical rows for any legacy rows that don't already have an equivalent,
--    then delete the legacy rows. ON CONFLICT preserves any existing canonical row's
--    `visible` value (admin's intent wins).
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

DELETE FROM role_tool_visibility
  WHERE role IN ('front_desk', 'personal_trainer', 'director');

-- 4) Tighten the staff.role CHECK constraint to canonical values only.
ALTER TABLE staff DROP CONSTRAINT staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('team_member', 'lead', 'manager', 'corporate', 'admin'));

COMMIT;
