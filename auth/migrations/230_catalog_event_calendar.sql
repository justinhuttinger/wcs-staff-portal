-- "Event Calendar" Tools tile: a planning calendar for general managers that
-- holds only in-person events for their own clubs. Events are ordinary
-- marketing_efforts rows (type 'event'), so they land on the Marketing Tracker
-- calendar with no extra table. Same recipe as 228 (ghlScripts). Seeds
-- (idempotent):
--   1. The permission_catalog row, so the Roles & Permissions grid and the
--      per-person overrides editor offer it under Tools. min_tier is
--      reference-only.
--   2. role_tool_visibility for manager (the GMs) and admin. Corporate already
--      sees every event in the Marketing Tracker; tick it in the Roles grid if
--      they want this view too.
-- The /event-calendar API gates on requireTile('eventCalendar'), so the tile
-- and the API agree.

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('eventCalendar', 'Event Calendar', 'Tools', 'manager')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'eventCalendar', true
from (values ('manager'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;
