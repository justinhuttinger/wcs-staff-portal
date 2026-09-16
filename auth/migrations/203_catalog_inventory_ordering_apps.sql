-- Inventory, Ordering, Insights and Send Notifications become role/override-
-- driven like the other catalog permissions. All four were hardcoded by tier
-- (Inventory + Ordering lead+, Insights + Send Notifications manager+), so they
-- appeared in neither the Roles & Permissions grid nor the per-person overrides
-- editor. Same recipe as 086 (trainerAvail). Seeds (idempotent):
--   1. permission_catalog rows. min_tier is reference-only (no ceiling).
--   2. role_tool_visibility rows reproducing today's effective visibility, so
--      nobody gains or loses a tile when the frontend switches from the tier
--      gate to visible_tools. No custom RBAC v2 roles exist to seed.
-- The legacy 'custom' role is not seeded: it reads per-person custom_tiles.
-- HR Docs and Analytics stay tier-locked on purpose (manager-scoped data).

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('inventory',     'Inventory',          'Tools', 'lead'),
  ('ordering',      'Ordering',           'Tools', 'team_member'),
  ('insights',      'Insights',           'Apps',  'team_member'),
  ('notifications', 'Send Notifications', 'Apps',  'team_member')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
select r.role, k.tool_key, true
from (values ('inventory'), ('ordering')) as k(tool_key)
cross join (values ('lead'), ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;

insert into role_tool_visibility (role, tool_key, visible)
select r.role, k.tool_key, true
from (values ('insights'), ('notifications')) as k(tool_key)
cross join (values ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;
