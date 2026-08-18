-- Make the NPS report visible in the Roles grid.
--
-- Report visibility is driven entirely by report:<key> grants in
-- role_tool_visibility (see migration 084). Adding a tile to ReportingView and
-- a tier gate to the route is not enough: without a catalog entry the report
-- cannot be represented in Admin -> Roles, and without a visibility row nobody
-- sees it. This is the third registration point and the easiest to miss.

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('report:nps', 'NPS', 'Reports', 'manager')
on conflict (perm_key) do nothing;

-- Same tiers the route's requireReportAccess('manager', ['nps']) allows, so the
-- grid and the gate agree. A role that can see the tile can load the data.
insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'report:nps', true
from (values ('manager'), ('marketing'), ('corporate'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;
