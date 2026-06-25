-- RBAC v2: named roles, per-person permission overrides, permission catalog.

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  base_tier text not null check (base_tier in ('team_member','lead','manager','corporate','admin')),
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff_permission_overrides (
  staff_id uuid not null references staff(id) on delete cascade,
  perm_key text not null,
  visible boolean not null,
  created_at timestamptz not null default now(),
  primary key (staff_id, perm_key)
);

create table if not exists permission_catalog (
  perm_key text primary key,
  label text not null,
  category text not null check (category in ('Apps','Tools','Reports','Actions')),
  min_tier text not null check (min_tier in ('team_member','lead','manager','corporate','admin'))
);

-- Service-role only: enable RLS with no policy (matches the project convention).
alter table roles enable row level security;
alter table staff_permission_overrides enable row level security;
alter table permission_catalog enable row level security;

-- Seed built-in roles. Names match today's staff.role strings so existing
-- role_tool_visibility rows keep resolving. base_tier maps aliases/legacy to a
-- canonical tier.
insert into roles (name, base_tier, is_builtin) values
  ('team_member','team_member',true),
  ('front_desk','team_member',true),
  ('personal_trainer','team_member',true),
  ('lead','lead',true),
  ('custom','lead',true),
  ('manager','manager',true),
  ('corporate','corporate',true),
  ('director','corporate',true),
  ('marketing','corporate',true),
  ('admin','admin',true)
on conflict (name) do nothing;

-- Seed the report permission catalog from the current REPORT_ACCESS matrix.
-- min_tier = the lowest tier currently allowed each report.
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('report:membership','Membership Report','Reports','lead'),
  ('report:club-health','Club Health Report','Reports','manager'),
  ('report:pt','PT Report','Reports','lead'),
  ('report:checkins','Check-ins Report','Reports','lead'),
  ('report:pt-sessions','PT Sessions Report','Reports','lead'),
  ('report:payroll','Payroll Report','Reports','manager'),
  ('report:revenue','Revenue Report','Reports','manager'),
  ('report:marketing','Marketing Report','Reports','corporate'),
  ('report:daily-snapshot','Daily Snapshot','Reports','manager')
on conflict (perm_key) do nothing;
