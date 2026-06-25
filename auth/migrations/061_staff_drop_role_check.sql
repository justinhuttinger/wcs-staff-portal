-- RBAC v2: allow custom role names in staff.role.
-- The legacy CHECK constraint hard-codes the built-in role names, so an
-- admin-created custom role could never be assigned to a staff member. The
-- roles table is now the source of truth for valid role names, and the admin
-- staff endpoints (POST/PUT /admin/staff) validate the role against it
-- (resolveAssignableRole) before writing. staff is written only by those
-- admin-gated endpoints and the ABC/GHL sync (which never sets custom roles).
alter table staff drop constraint if exists staff_role_check;
