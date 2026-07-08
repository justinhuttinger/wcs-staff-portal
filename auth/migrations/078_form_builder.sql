-- Form Builder module: internal Jotform replacement.
-- Tables are service-role only (RLS enabled, no policies), matching migration 035 convention.

create table if not exists forms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text,
  schema jsonb not null default '[]'::jsonb,
  owner_id uuid not null references staff(id),
  location_id uuid not null references locations(id),
  visibility text not null default 'private' check (visibility in ('private','location','shared')),
  location_can_edit boolean not null default false,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  sheet_id text,
  sheet_tab text,
  sheet_columns jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id),
  data jsonb not null,
  submitted_at timestamptz not null default now(),
  synced_to_sheet boolean not null default false,
  sync_error text
);
create index if not exists idx_form_submissions_form on form_submissions (form_id, submitted_at desc);
create index if not exists idx_form_submissions_unsynced on form_submissions (form_id) where synced_to_sheet = false;

create table if not exists form_shares (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  permission text not null check (permission in ('viewer','editor')),
  granted_by uuid references staff(id),
  created_at timestamptz not null default now(),
  unique (form_id, staff_id)
);

-- Append-only audit trail. form_id intentionally has NO foreign key so audit
-- rows survive a hard-deleted draft. Never UPDATE or DELETE rows here.
create table if not exists form_audit_log (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null,
  actor_id uuid,
  action text not null check (action in (
    'created','edited','published','archived','deleted','shared','unshared',
    'permission_changed','visibility_changed','submission_received','sheet_retry')),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_form_audit_form on form_audit_log (form_id, created_at desc);
create index if not exists idx_form_audit_actor on form_audit_log (actor_id, created_at desc);

-- The service role bypasses RLS, so append-only must be enforced by trigger.
create or replace function form_audit_log_immutable() returns trigger as $$
begin
  raise exception 'form_audit_log is append-only';
end;
$$ language plpgsql;

drop trigger if exists trg_form_audit_immutable on form_audit_log;
create trigger trg_form_audit_immutable
  before update or delete on form_audit_log
  for each row execute function form_audit_log_immutable();

alter table forms enable row level security;
alter table form_submissions enable row level security;
alter table form_shares enable row level security;
alter table form_audit_log enable row level security;

-- RBAC v2: make the Forms tool grantable to custom roles / individuals.
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('forms', 'Forms', 'Tools', 'lead')
on conflict (perm_key) do nothing;

-- Seed the built-in role toggles so manager+ see the tile by default.
insert into role_tool_visibility (role, tool_key, visible)
select r, 'forms', true from unnest(array['manager','corporate','admin']) as r
on conflict (role, tool_key) do update set visible = true;
