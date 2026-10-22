-- Inventory Audit becomes its own role/override-driven permission. It was
-- hardcoded admin-only (requireRole('admin') on /inventory/audit and
-- /cost-import, plus the admin check on PATCH /items/:id cost/UPC edits).
-- Now managers and up get it by default, and it shows in the Roles &
-- Permissions grid and the per-person overrides editor so it can be granted
-- to (or pulled from) anyone. Same recipe as 203 (inventory/ordering).
--
-- Holding the permission = see the Audit tab, edit item cost/UPC (fanned out
-- to every club's copy of the product), and bulk Import Costs.
-- The 'inventory' tile is still required (router-level requireTile).
-- The legacy 'custom' role is not seeded: it reads per-person custom_tiles.
-- No RBAC v2 custom roles exist at manager+ to seed.
-- Idempotent: safe to re-run.

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('inventory-audit', 'Inventory - Audit', 'Tools', 'manager')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'inventory-audit', true
from (values ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;
