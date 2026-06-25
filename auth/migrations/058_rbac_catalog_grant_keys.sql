-- RBAC v2: catalog the report GRANT keys that requireReportAccess actually
-- checks (kpis, meta-ads, google-marketing). Without these rows a per-person
-- force-on override of one of these keys would skip the tier ceiling, because
-- an uncatalogued key has no min_tier. min_tier matches each call site's minRole.
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('report:kpis','KPIs Report','Reports','manager'),
  ('report:meta-ads','Meta Ads Report','Reports','corporate'),
  ('report:google-marketing','Google Marketing Report','Reports','corporate')
on conflict (perm_key) do nothing;
