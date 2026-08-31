-- Retire the WhenIWork tile.
--
-- The `wheniwork` key was seeded into permission_catalog by
-- 062_catalog_builtin_apps.sql and could be granted three ways: per role
-- (role_tool_visibility), per person (staff_permission_overrides), and to a
-- custom-role member (staff.custom_tiles). All three are cleared here so no
-- account is left holding a grant for a tile that renders nothing.
--
-- Follows the pattern established by 105_ticketing_replaces_clickup_tickets.sql.

delete from permission_catalog         where perm_key = 'wheniwork';
delete from role_tool_visibility       where tool_key = 'wheniwork';
delete from staff_permission_overrides where perm_key = 'wheniwork';

-- staff.custom_tiles is a text[] (NOT jsonb), so strip the retired key with
-- array_remove. A jsonb operator would throw on any matching row.
update staff
   set custom_tiles = array_remove(custom_tiles, 'wheniwork')
 where custom_tiles is not null and 'wheniwork' = any(custom_tiles);

-- Help Center article bodies are stored in the help_articles table
-- (see auth/src/routes/helpCenter.js), not in auth/seed/seed-help-center.js.
-- That seed file was reworded on this branch, but it is a one-shot script
-- nobody runs on deploy, so it only fixes a fresh install. Existing rows
-- would keep telling staff to use WhenIWork unless patched here. A migration
-- doing a content edit is unusual, but the seed is not the source of truth
-- for already-seeded, possibly hand-edited article bodies, and matching by
-- title (as the seed does) risks clobbering a hand edit. Matching the
-- WhenIWork fragment itself avoids that and is safe to rerun: once the
-- fragment is gone, each replace() below is a no-op.
--
-- Covers the known live wording, "WhenIWork (scheduling), " as a mid- or
-- start-of-list item (removes the item plus its trailing separator so no
-- double comma or double space is left), then the end-of-list forms with an
-- Oxford comma ("... , and WhenIWork (scheduling)"), without one
-- ("... and WhenIWork (scheduling)"), and a plain leading comma
-- ("... , WhenIWork (scheduling)"), each of which also removes the
-- now-dangling separator before it, plus a bare "WhenIWork (scheduling)"
-- mention with no list punctuation around it at all.
update help_articles
   set body = replace(
                 replace(
                   replace(
                     replace(
                       replace(body, 'WhenIWork (scheduling), ', ''),
                     ', and WhenIWork (scheduling)', ''),
                   ' and WhenIWork (scheduling)', ''),
                 ', WhenIWork (scheduling)', ''),
               'WhenIWork (scheduling)', '')
 where body like '%WhenIWork (scheduling)%';

-- Fallback for a hand-edited body that mentions bare "WhenIWork" with no
-- "(scheduling)" suffix, in the same list-separator shapes as above.
update help_articles
   set body = replace(
                 replace(
                   replace(
                     replace(
                       replace(body, 'WhenIWork, ', ''),
                     ', and WhenIWork', ''),
                   ' and WhenIWork', ''),
                 ', WhenIWork', ''),
               'WhenIWork', '')
 where body like '%WhenIWork%' and body not like '%WhenIWork (scheduling)%';
