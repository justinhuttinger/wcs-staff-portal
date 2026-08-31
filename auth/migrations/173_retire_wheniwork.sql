-- Retire the WhenIWork tile.
--
-- The `wheniwork` key was seeded into permission_catalog by
-- 062_catalog_builtin_apps.sql and could be granted three ways: per role
-- (role_tool_visibility), per person (staff_permission_overrides), and to a
-- custom-role member (staff.custom_tiles). All three are cleared here so no
-- account is left holding a grant for a tile that renders nothing.
--
-- Follows the pattern established by 105_ticketing_replaces_clickup_tickets.sql.

delete from permission_catalog         where perm_key = 'wheniwork';
delete from role_tool_visibility       where tool_key = 'wheniwork';
delete from staff_permission_overrides where perm_key = 'wheniwork';

-- staff.custom_tiles is a text[] (NOT jsonb), so strip the retired key with
-- array_remove. A jsonb operator would throw on any matching row.
update staff
   set custom_tiles = array_remove(custom_tiles, 'wheniwork')
 where custom_tiles is not null and 'wheniwork' = any(custom_tiles);
