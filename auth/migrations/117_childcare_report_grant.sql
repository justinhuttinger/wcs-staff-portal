-- 117_childcare_report_grant.sql
-- Register the childcare headcount report.
--
-- Report visibility is driven entirely by report:<key> grants in
-- role_tool_visibility (see migration 084). Adding a tile to ReportingView and
-- a tier gate to the route is not enough: without a catalog entry the report
-- cannot be represented in Admin -> Roles, and without a visibility row nobody
-- sees it.
--
-- ADMIN ONLY. Unlike other reports this seeds a single role row — no manager,
-- corporate or marketing. The route is gated requireReportAccess('admin', ...)
-- and `admin` is the top tier, so this cannot be widened by accident. To scope
-- it to one person instead, delete the visibility row below and grant
-- report:childcare as a per-person override in Admin -> Staff.

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('report:childcare', 'Childcare', 'Reports', 'admin')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible) values
  ('admin', 'report:childcare', true)
on conflict (role, tool_key) do update set visible = true;
