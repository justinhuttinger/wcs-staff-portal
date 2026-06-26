-- Reconcile the Reports group in permission_catalog to the canonical report
-- tile keys so the roles grid offers exactly the reports whose endpoints honor
-- a grant (requireReportAccess). Reports whose endpoints are not yet grant-aware
-- (operations, audits, pos-sales) are intentionally omitted until rewired.
-- min_tier is retained for reference only — there is no tier ceiling anymore.
delete from permission_catalog where perm_key like 'report:%';
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('report:club-health',       'Club Health',        'Reports', 'manager'),
  ('report:membership',        'Membership',         'Reports', 'lead'),
  ('report:cancels',           'Cancels',            'Reports', 'lead'),
  ('report:pt',                'Day One',            'Reports', 'lead'),
  ('report:pt-roster',         'PT Roster',          'Reports', 'lead'),
  ('report:checkins',          'Check-ins',          'Reports', 'lead'),
  ('report:pt-sessions',       'Trainer Load',       'Reports', 'lead'),
  ('report:pt-new-clients',    'PT New Clients',     'Reports', 'lead'),
  ('report:session-frequency', 'Session Frequency',  'Reports', 'lead'),
  ('report:deactivated-pt',    'Deactivated PT',     'Reports', 'lead'),
  ('report:pt-projections',    'PT Projections',     'Reports', 'manager'),
  ('report:pt-health',         'PT Health',          'Reports', 'lead'),
  ('report:payroll',           'Payroll',            'Reports', 'manager'),
  ('report:revenue',           'Revenue',            'Reports', 'manager'),
  ('report:daily-snapshot',    'Daily Snapshot',     'Reports', 'manager'),
  ('report:kpis',              'KPIs',               'Reports', 'manager'),
  ('report:meta-ads',          'Meta Ads',           'Reports', 'corporate'),
  ('report:google-marketing',  'Google Marketing',   'Reports', 'corporate')
on conflict (perm_key) do nothing;
