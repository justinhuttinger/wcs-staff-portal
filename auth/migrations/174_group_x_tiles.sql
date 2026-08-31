-- Group X moves from an admin-only screen to a home-board tile with its own
-- permissions, so the Roles & Permissions grid needs rows to drive it.
--
-- Three keys, all under Tools:
--   groupX               - see the Group X tile and read the schedule and the
--                          attendance log. Granted to every built-in role: the
--                          class schedule is a lobby handout, and front desk
--                          needs to be able to print it.
--   groupX:schedule-edit - add and cancel classes, run recurring series, badge
--                          new classes.
--   groupX:attendance    - record a class headcount.
--
-- The two write keys are seeded for lead and above, matching the split between
-- "base" roles (front desk / personal trainer, who look and print) and everyone
-- above them. Admins bypass these gates in the route regardless, so the Admin
-- Panel copy of the screen keeps working whatever the grid says.
--
-- The built-in 'custom' role is deliberately NOT seeded: it reads per-person
-- staff.custom_tiles rather than role_tool_visibility, so a row here would be
-- inert. Grant these keys to a custom-role member per person instead. Same
-- reasoning as 086_catalog_trainer_avail.sql.
--
-- Idempotent: safe to re-run.

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('groupX',               'Group X',                  'Tools', 'team_member'),
  ('groupX:schedule-edit', 'Group X - Edit Schedule',  'Tools', 'lead'),
  ('groupX:attendance',    'Group X - Log Attendance', 'Tools', 'lead')
on conflict (perm_key) do nothing;

-- Everyone can see the tile and read the schedule.
insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'groupX', true
from (values
  ('team_member'), ('front_desk'), ('personal_trainer'),
  ('lead'), ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')
) as r(role)
on conflict (role, tool_key) do update set visible = true;

-- Lead and above can edit the schedule and log attendance.
insert into role_tool_visibility (role, tool_key, visible)
select r.role, k, true
from (values
  ('lead'), ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')
) as r(role)
cross join unnest(array['groupX:schedule-edit', 'groupX:attendance']) as k
on conflict (role, tool_key) do update set visible = true;
