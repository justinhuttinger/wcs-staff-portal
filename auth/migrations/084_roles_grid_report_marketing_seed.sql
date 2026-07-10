-- Roles grid becomes the source of truth for report + marketing VISIBILITY.
-- This seeds role_tool_visibility with each built-in role's CURRENT effective
-- report/marketing set (from the hardcoded frontend defaults) so that when the
-- frontend stops using those hardcoded lists, nobody loses access. Idempotent:
-- safe to re-run. Backend tier gates are unchanged; this only drives visibility.
--
-- Report keys match ReportingView.jsx ALL_REPORT_TILES on current master (note
-- the report key is 'compliance', not 'operations'). Manager reports = UNION of
-- the old desktop + mobile hardcoded lists (adds pt-projections); all are reports
-- managers are already tier-authorized for. Corporate/admin already carried 18
-- catalog report keys from an earlier partial seed; this tops them up to 22 and
-- adds marketing rows for the marketing/director roles.

-- 1. Add the report keys that exist as tiles but were missing from the
--    permission_catalog (so every real report is representable in the grid).
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('report:pos-sales',       'POS Sales',       'Reports', 'manager'),
  ('report:till',            'Till',            'Reports', 'manager'),
  ('report:compliance',      'Compliance',      'Reports', 'manager'),
  ('report:email-marketing', 'Email Marketing', 'Reports', 'corporate'),
  ('report:audits',          'Audits',          'Reports', 'manager')
on conflict (perm_key) do nothing;

-- 2. Seed each role's report grants (report:<key>), reproducing today's access.
insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'report:' || k, true
from (values
  ('lead',      array['membership','cancels','pt','pt-roster','checkins','pt-sessions','pt-new-clients','session-frequency','deactivated-pt','pt-health']),
  ('manager',   array['membership','cancels','pt','club-health','pt-roster','checkins','pt-sessions','pt-new-clients','session-frequency','deactivated-pt','pt-health','payroll','compliance','revenue','pos-sales','till','kpis','audits','pt-projections']),
  ('marketing', array['club-health','membership','cancels','pt','pt-roster','checkins','pt-sessions','pt-new-clients','session-frequency','deactivated-pt','pt-projections','pt-health','payroll','revenue','pos-sales','till','compliance','meta-ads','google-marketing','email-marketing']),
  ('corporate', array['club-health','membership','cancels','pt','pt-roster','checkins','pt-sessions','pt-new-clients','session-frequency','deactivated-pt','pt-projections','pt-health','payroll','revenue','pos-sales','till','compliance','meta-ads','google-marketing','email-marketing','kpis','audits']),
  ('director',  array['club-health','membership','cancels','pt','pt-roster','checkins','pt-sessions','pt-new-clients','session-frequency','deactivated-pt','pt-projections','pt-health','payroll','revenue','pos-sales','till','compliance','meta-ads','google-marketing','email-marketing','kpis','audits']),
  ('admin',     array['club-health','membership','cancels','pt','pt-roster','checkins','pt-sessions','pt-new-clients','session-frequency','deactivated-pt','pt-projections','pt-health','payroll','revenue','pos-sales','till','compliance','meta-ads','google-marketing','email-marketing','kpis','audits'])
) as r(role, keys)
cross join lateral unnest(r.keys) as k
on conflict (role, tool_key) do update set visible = true;

-- 3. Seed marketing capabilities + all effort types for the full-marketing roles
--    (matches today's corporate+ tier fast-path, which the frontend drops).
insert into role_tool_visibility (role, tool_key, visible)
select r.role, k, true
from (values ('marketing'), ('corporate'), ('director'), ('admin')) as r(role)
cross join unnest(array[
  'marketing:tracker','marketing:needs','marketing:research',
  'marketing_type:ad_tvs','marketing_type:app_blast','marketing_type:email','marketing_type:event',
  'marketing_type:facebook_event','marketing_type:flyer','marketing_type:meta_ad','marketing_type:sms',
  'marketing_type:social_post','marketing_type:website'
]) as k
on conflict (role, tool_key) do update set visible = true;
