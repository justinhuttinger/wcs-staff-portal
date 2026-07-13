-- D1 Availability (trainerAvail) becomes role/override-driven like the other
-- catalog permissions. The tile was hardcoded manager+ in ToolGrid.jsx and so
-- never appeared in the Roles & Permissions grid or the per-person overrides
-- editor. Seeds (idempotent):
--   1. The permission_catalog row so both the roles grid and the overrides
--      editor offer it under Tools. min_tier is reference-only (no ceiling).
--   2. role_tool_visibility rows reproducing today's effective visibility —
--      every built-in role at manager tier or above — so nobody gains or loses
--      the tile when the frontend switches from the hardcoded tier gate to
--      visible_tools. Custom RBAC v2 roles are NOT seeded: their names resolve
--      to level 0 in the frontend today, so they never saw the tile.
-- The legacy 'custom' role is also not seeded: it reads per-person
-- custom_tiles, where trainerAvail was already grantable.

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('trainerAvail', 'D1 Availability', 'Tools', 'team_member')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'trainerAvail', true
from (values ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;
