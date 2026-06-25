-- Seed the built-in app toggles into permission_catalog so they appear in the
-- RBAC v2 permission grid (Apps group). These six keys already live in
-- role_tool_visibility and were editable from the legacy "Roles / Tool
-- Visibility" admin page; this lets the consolidated "Roles & Permissions" grid
-- show and edit them too, so the legacy page can be retired. min_tier
-- team_member means they are never ceiling-locked (available to every role).
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('grow',      'Grow (CRM)',    'Apps', 'team_member'),
  ('abc',       'ABC Financial', 'Apps', 'team_member'),
  ('wheniwork', 'WhenIWork',     'Apps', 'team_member'),
  ('paychex',   'Paychex',       'Apps', 'team_member'),
  ('gmail',     'Gmail',         'Apps', 'team_member'),
  ('drive',     'Google Drive',  'Apps', 'team_member')
on conflict (perm_key) do nothing;
