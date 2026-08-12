-- Native ticketing replaces the ClickUp ticket system.
--
-- The old "tickets" tile (ClickUp form embeds + the ClickUp status dashboard)
-- is gone. The native module keeps its own key, `ticketing`, which was already
-- in permission_catalog but pinned to min_tier 'admin' — so it never appeared
-- as a grantable tile in the roles grid or the custom-role picker. That is the
-- whole reason the new system wasn't showing up there.
--
-- 1. Open `ticketing` to every tier. Anyone can submit a ticket; handler
--    controls are gated separately by the ticket type's handler_ids, not by
--    tile visibility, so lowering this grants no editing power.
update permission_catalog
   set min_tier = 'team_member',
       label    = 'Ticketing',
       category = 'Tools'
 where perm_key = 'ticketing';

insert into permission_catalog (perm_key, label, category, min_tier)
select 'ticketing', 'Ticketing', 'Tools', 'team_member'
 where not exists (select 1 from permission_catalog where perm_key = 'ticketing');

-- 2. Retire the old key wherever it was granted. It renders nothing now.
delete from permission_catalog        where perm_key = 'tickets';
delete from role_tool_visibility      where tool_key = 'tickets';
delete from staff_permission_overrides where perm_key = 'tickets';
-- staff.custom_tiles is a text[] (NOT jsonb), so strip the retired key with
-- array_remove. The jsonb form this originally shipped with would have thrown
-- on any matching row; it only escaped notice because no staff member had the
-- old 'tickets' tile when it ran.
update staff
   set custom_tiles = array_remove(custom_tiles, 'tickets')
 where custom_tiles is not null and 'tickets' = any(custom_tiles);

-- 3. Turn the tile on for every role that exists today, so the replacement is
--    visible immediately rather than requiring a pass through the grid. Admins
--    can switch any role back off in Roles afterwards.
insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'ticketing', true
  from (select distinct role from role_tool_visibility) r
 where not exists (
   select 1 from role_tool_visibility x
    where x.role = r.role and x.tool_key = 'ticketing'
 );

update role_tool_visibility set visible = true where tool_key = 'ticketing';
