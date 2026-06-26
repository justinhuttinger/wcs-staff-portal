-- RBAC v2: marketing becomes a per-role capability instead of a per-staff
-- add-on. A role (or per-person override) may grant any subset of the three
-- Marketing Tracker sections, plus any subset of the effort TYPES it can work
-- with. Legacy access (corporate+ tier or the marketing_addon flag) still
-- grants all three sections and the member's existing type/club scope.
-- min_tier is retained for reference only — there is no tier ceiling anymore.

-- Widen the category CHECK to admit the two new marketing categories. (063
-- left only Apps/Tools/Reports/Actions; the grid needs Marketing rows too.)
alter table permission_catalog drop constraint if exists permission_catalog_category_check;
alter table permission_catalog add constraint permission_catalog_category_check
  check (category = any (array['Apps', 'Tools', 'Reports', 'Marketing', 'Marketing Types', 'Actions']));

-- The three tracker sections.
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('marketing:tracker',  'Marketing Tracker',  'Marketing', 'team_member'),
  ('marketing:needs',    'Marketing Needs List','Marketing', 'team_member'),
  ('marketing:research', 'Marketing Research', 'Marketing', 'team_member')
on conflict (perm_key) do nothing;

-- The effort types selectable in the tracker. Keys mirror marketing_efforts.type.
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('marketing_type:meta_ad',        'Meta Ad',        'Marketing Types', 'team_member'),
  ('marketing_type:social_post',    'Social Post',    'Marketing Types', 'team_member'),
  ('marketing_type:flyer',          'Flyer',          'Marketing Types', 'team_member'),
  ('marketing_type:facebook_event', 'Facebook Event', 'Marketing Types', 'team_member'),
  ('marketing_type:event',          'Event',          'Marketing Types', 'team_member'),
  ('marketing_type:email',          'Email',          'Marketing Types', 'team_member'),
  ('marketing_type:sms',            'SMS',            'Marketing Types', 'team_member'),
  ('marketing_type:app_blast',      'App Blast',      'Marketing Types', 'team_member'),
  ('marketing_type:ad_tvs',         'Ad TVs',         'Marketing Types', 'team_member'),
  ('marketing_type:website',        'Website',        'Marketing Types', 'team_member')
on conflict (perm_key) do nothing;
