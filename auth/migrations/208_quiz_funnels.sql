-- 208: Quiz Funnels. A quiz is a forms row with kind='quiz' that runs at a set
-- of clubs (quiz_clubs). Each club carries its own GHL inbound webhook and GHL
-- External Tracking snippet. Submissions remember their club and webhook state.

alter table forms add column if not exists kind text not null default 'form';
do $$ begin
  alter table forms add constraint forms_kind_check check (kind in ('form','quiz'));
exception when duplicate_object then null; end $$;
create index if not exists idx_forms_kind on forms (kind);

create table if not exists quiz_clubs (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id) on delete cascade,
  location_id uuid not null references locations(id),
  active boolean not null default true,
  ghl_webhook_url text,
  ghl_tracking_src text,
  ghl_tracking_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, location_id)
);
alter table quiz_clubs enable row level security;

alter table form_submissions add column if not exists location_id uuid references locations(id);
alter table form_submissions add column if not exists webhook_status text not null default 'none';
alter table form_submissions add column if not exists webhook_attempts int not null default 0;
alter table form_submissions add column if not exists webhook_error text;
do $$ begin
  alter table form_submissions add constraint form_submissions_webhook_status_check
    check (webhook_status in ('none','pending','sent','failed'));
exception when duplicate_object then null; end $$;
create index if not exists idx_form_submissions_webhook_retry
  on form_submissions (submitted_at) where webhook_status in ('pending','failed');

-- Audit actions. 'location_changed' was already written by PATCH /forms/:id
-- (All-Locations work, #472) but never added to the check, so those inserts
-- were silently rejected. Add it alongside the quiz actions.
alter table form_audit_log drop constraint if exists form_audit_log_action_check;
alter table form_audit_log add constraint form_audit_log_action_check check (action in (
  'created','edited','published','archived','deleted','shared','unshared',
  'permission_changed','visibility_changed','submission_received','sheet_retry',
  'location_changed','clubs_updated','webhook_test','webhook_retry'));

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('quizzes', 'Quiz Funnels', 'Tools', 'admin')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible) values ('admin', 'quizzes', true)
on conflict (role, tool_key) do update set visible = true;
