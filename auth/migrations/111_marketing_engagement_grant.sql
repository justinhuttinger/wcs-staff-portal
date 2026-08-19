-- Make the Marketing Engagement report visible in the Roles grid.
--
-- Report visibility is driven entirely by report:<key> grants in
-- role_tool_visibility (see migration 084). A tile in ReportingView and a tier
-- gate on the route are not enough: without a catalog entry the report cannot
-- be represented in Admin -> Roles, and without a visibility row nobody sees it.

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('report:marketing-engagement', 'Marketing Engagement', 'Reports', 'corporate')
on conflict (perm_key) do nothing;

-- Same tiers the route's requireReportAccess('corporate', ['marketing-engagement'])
-- allows, so the grid and the gate agree. The legacy marketing tier is included
-- to match how Email Marketing and Meta Ads are granted.
insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'report:marketing-engagement', true
from (values ('marketing'), ('corporate'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;
