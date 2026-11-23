-- 263: Transformation Challenge report (auth/src/routes/challengeReport.js).
--
-- Who bought a challenge entry: GHL payment-link purchases (Payments ->
-- Transactions) whose product name contains name_match, since season_start.
-- Tiers come from the product name (Kick Start / Challenger / All In), with the
-- price ($25 / $57 / $97) as the fallback.
--
-- Seasonal: Admin -> Challenge Report turns it on and off. While off, the report
-- is hidden from the Reporting list for everyone and its endpoint returns
-- nothing. One row, id = 1.

create table if not exists public.challenge_report_settings (
  id            integer     primary key default 1 check (id = 1),
  enabled       boolean     not null default false,
  season_start  date        not null,
  season_end    date,                                   -- null = open-ended
  name_match    text        not null default 'Transformation Challenge',
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

-- The 2027 challenge payment links went live 2026-11-16. Last season's
-- "Transformation Challenge Participant" sales (Dec 2025 - Jan 2026) fall
-- before this start date, so they stay out.
insert into public.challenge_report_settings (id, enabled, season_start)
values (1, true, '2026-11-01')
on conflict (id) do nothing;

-- Service role only (portal-wide convention): RLS on, no policies.
alter table public.challenge_report_settings enable row level security;

-- Roles grid (migration 084 pattern). Managers see their own clubs; the
-- all-location roles see every club. Widen or narrow in Admin -> Roles.
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('report:challenge', 'Challenge', 'Reports', 'manager')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'report:challenge', true
from (values ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;

notify pgrst, 'reload schema';
