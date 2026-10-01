-- "Workflows & Scripts (GHL)" becomes its own Tools tile. It is the GHL custom
-- value editor (drip SMS copy and the call scripts the GHL banner shows), which
-- until now was the Drip Campaigns tab inside Marketing and rode on marketing
-- access. Same recipe as 086 (trainerAvail). Seeds (idempotent):
--   1. The permission_catalog row, so the Roles & Permissions grid and the
--      per-person overrides editor offer it under Tools. min_tier is
--      reference-only (no ceiling).
--   2. role_tool_visibility for the corporate-tier built-in roles and admin.
--      Leads and managers are not seeded: the tile is corporate only.
--   3. Paige Milam, who is on the legacy 'custom' role and so reads her own
--      custom_tiles rather than a role grid.
-- The /custom-values API moves from requireMarketing to requireTile in the
-- same change, so the tile and the API agree. Anyone below corporate who
-- reached the old tab through marketing access loses it (none do today
-- besides the custom-role members, who are granted per person).

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('ghlScripts', 'Workflows & Scripts (GHL)', 'Tools', 'corporate')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'ghlScripts', true
from (values ('corporate'), ('director'), ('marketing'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;

update staff
set custom_tiles = array_append(custom_tiles, 'ghlScripts')
where id = 'e2786add-5553-4a98-9d3b-470e4971cf89'
  and role = 'custom'
  and not ('ghlScripts' = any(coalesce(custom_tiles, '{}')));
