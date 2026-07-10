-- 080: Restrict the Forms module to admin only.
-- 078 seeded the 'forms' tile visible for manager/corporate/admin. Justin
-- narrowed access to admin and above (2026-07-10), so flip every non-admin
-- role's toggle off. Admins can still re-grant a specific role or person
-- through the RBAC screens if that ever changes.
update role_tool_visibility
set visible = false
where tool_key = 'forms' and role <> 'admin';

-- Keep the catalog entry grantable only from admin-tier screens.
update permission_catalog
set min_tier = 'admin'
where perm_key = 'forms';
