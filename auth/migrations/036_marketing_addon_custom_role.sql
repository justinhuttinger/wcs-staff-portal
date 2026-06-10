-- 036_marketing_addon_custom_role.sql
--
-- Two related changes to how access is modeled:
--
-- 1) "Marketing" becomes an ADD-ON capability instead of a standalone role.
--    Any staff member (front desk, lead, manager, corporate, …) can have the
--    marketing add-on layered on top of their base role. The add-on can be
--    scoped to specific clubs and specific marketing effort types, so e.g. a
--    Springfield team member who only runs Instagram sees only Springfield +
--    social posts in the Marketing Tracker.
--
--      marketing_addon    — whether the add-on is enabled at all.
--      marketing_locations— club slugs the add-on can see/edit in the tracker.
--                           NULL = all clubs (no restriction).
--      marketing_types    — effort type slugs the add-on can see/edit.
--                           NULL = all types (no restriction).
--
-- 2) A new "custom" base role whose portal tiles and reports are chosen per
--    person (clubs are still controlled by staff_locations). Empty/NULL means
--    "nothing granted yet".
--
--      custom_tiles   — portal tile keys this person can see (see
--                       portal/src/config/portalTiles.js for the catalog).
--      custom_reports — report keys this person can open in Reporting.
--
-- This migration is idempotent.

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS marketing_addon     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_locations text[],
  ADD COLUMN IF NOT EXISTS marketing_types     text[],
  ADD COLUMN IF NOT EXISTS custom_tiles        text[],
  ADD COLUMN IF NOT EXISTS custom_reports      text[];

COMMENT ON COLUMN staff.marketing_addon     IS 'Marketing add-on enabled (layers on top of base role)';
COMMENT ON COLUMN staff.marketing_locations IS 'Marketing Tracker club slugs (NULL = all clubs)';
COMMENT ON COLUMN staff.marketing_types     IS 'Marketing Tracker effort type slugs (NULL = all types)';
COMMENT ON COLUMN staff.custom_tiles        IS 'Portal tile keys granted to a custom-role member';
COMMENT ON COLUMN staff.custom_reports      IS 'Report keys granted to a custom-role member';

-- Widen the role CHECK constraint to add 'custom'. 'marketing' is kept as a
-- legal value for back-compat (older rows / environments may still carry it),
-- but the data step below converts existing marketing staff into the add-on.
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('team_member', 'lead', 'manager', 'corporate', 'marketing', 'custom', 'admin'));

ALTER TABLE role_tool_visibility DROP CONSTRAINT IF EXISTS role_tool_visibility_role_check;
ALTER TABLE role_tool_visibility ADD CONSTRAINT role_tool_visibility_role_check
  CHECK (role IN ('team_member', 'lead', 'manager', 'corporate', 'marketing', 'custom', 'admin'));

-- Convert existing marketing-role staff to: corporate base role (preserves
-- their all-clubs / all-reports access) + a fully-open marketing add-on
-- (NULL scope = all clubs and all types). Admins can narrow them afterward.
UPDATE staff
   SET role = 'corporate',
       marketing_addon = true,
       marketing_locations = NULL,
       marketing_types = NULL
 WHERE role = 'marketing';

COMMIT;
