-- Courts & Pool moves from an admin-only screen to a home-board tile, with the
-- same permission split Group X uses (174/175):
--
--   facility               - see the tile and read the court and pool
--                            schedules, and print them. Every built-in role.
--   facility:schedule-edit - add and cancel slots, run recurring series.
--                            Lead and above.
--
-- There is no attendance twin here: a court booking has no headcount to log,
-- so the split is just see/edit.
--
-- The built-in 'custom' role is not seeded, same as 174 -- it reads per-person
-- staff.custom_tiles, so a row here would be inert. Grant it per person.
-- Idempotent: safe to re-run.

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('facility',               'Courts & Pool',                 'Tools', 'team_member'),
  ('facility:schedule-edit', 'Courts & Pool - Edit Schedule', 'Tools', 'lead')
on conflict (perm_key) do nothing;

-- Everyone can see the schedules.
insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'facility', true
from (values
  ('team_member'), ('front_desk'), ('personal_trainer'),
  ('lead'), ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')
) as r(role)
on conflict (role, tool_key) do update set visible = true;

-- Lead and above can edit them.
insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'facility:schedule-edit', true
from (values
  ('lead'), ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')
) as r(role)
on conflict (role, tool_key) do update set visible = true;
