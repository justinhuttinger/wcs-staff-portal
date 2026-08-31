-- Logging a class headcount moves to the base roles.
--
-- 174 seeded groupX:attendance for lead and above, alongside
-- groupX:schedule-edit. In practice the person who knows how many people were
-- in the room is whoever was working the desk, and making them find a lead to
-- type a number in is how the queue stops getting cleared.
--
-- Editing the schedule stays lead and above: that writes to the live ABC
-- calendar, which is a different kind of action from recording what happened.
--
-- The built-in 'custom' role is not seeded here for the same reason as 174 --
-- it reads per-person staff.custom_tiles, so a row here would be inert. Grant
-- it per person for a custom-role member instead.
--
-- APPLIED TO PRODUCTION 2026-08-31, before this landed on master. Idempotent,
-- so re-running it on a fresh database is safe.

insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'groupX:attendance', true
from (values ('team_member'), ('front_desk'), ('personal_trainer')) as r(role)
on conflict (role, tool_key) do update set visible = true;
