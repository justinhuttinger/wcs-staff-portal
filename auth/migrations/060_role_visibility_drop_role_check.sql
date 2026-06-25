-- RBAC v2: allow custom role names in role_tool_visibility.
-- The legacy CHECK constraint hard-codes the built-in role names, so a custom
-- role's permission grid (seeded by POST /config/roles and written by
-- PUT /config/role-visibility) could never be persisted. The roles table is now
-- the source of truth for valid role names, and these endpoints validate the
-- name against it (validateRoleName) before writing, so the CHECK is obsolete.
-- Access to this table is service-role only (no untrusted writes).
alter table role_tool_visibility drop constraint if exists role_tool_visibility_role_check;
