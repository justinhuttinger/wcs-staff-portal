-- 076_operandio_api_compliance.sql
--
-- Operandio API compliance sync: job instances + per-step detail pulled from
-- the Operandio GraphQL API (api.operandio.com) by operandioSync. Replaces
-- email parsing as the source of truth for compliance reporting; the email
-- pipeline (operandio_job_events / operandio_task_completions) stays untouched.

create table if not exists operandio_api_jobs (
  id text primary key,                      -- Operandio job instance id
  location_slug text not null,
  operandio_location_id text not null,
  process_id text,
  process_name text,
  display_name text,
  schedule_name text,
  adhoc boolean not null default false,
  has_submit boolean not null default false,
  has_scoring boolean not null default false,
  percent_complete numeric,
  available_from timestamptz,
  due_at timestamptz,
  job_date date not null,                   -- Pacific calendar day of due_at
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by text,
  submitted boolean not null default false,
  submitted_at timestamptz,
  submitted_by text,
  started_at timestamptz,
  ended_at timestamptz,
  failed boolean,
  score numeric,
  possible_score numeric,
  assigned_users jsonb not null default '[]'::jsonb,   -- full names
  assigned_groups jsonb not null default '[]'::jsonb,  -- group names
  -- pending | in_progress | on_time | late | missed
  compliance_status text not null default 'pending',
  first_synced_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

create index if not exists idx_operandio_api_jobs_loc_date
  on operandio_api_jobs (location_slug, job_date);
create index if not exists idx_operandio_api_jobs_status
  on operandio_api_jobs (compliance_status, job_date);

create table if not exists operandio_api_job_steps (
  job_id text not null references operandio_api_jobs(id) on delete cascade,
  step_instance_id text not null,           -- per-job step instance id
  step_id text,                             -- originating process step id
  position int,
  name text,
  response_type text,
  response text,
  skip boolean,
  completed_at timestamptz,
  completed_by text,
  score numeric,
  possible_score numeric,
  failed boolean,
  notes jsonb not null default '[]'::jsonb, -- [{ text, author, createdAt }]
  synced_at timestamptz not null default now(),
  primary key (job_id, step_instance_id)
);

create index if not exists idx_operandio_api_job_steps_completed_by
  on operandio_api_job_steps (completed_by);

create table if not exists operandio_api_sync_state (
  location_slug text primary key,
  operandio_location_id text,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  jobs_synced int,
  window_start date,
  window_end date
);

-- Service-role only (portal backend); RLS on with no policies per convention.
alter table operandio_api_jobs enable row level security;
alter table operandio_api_job_steps enable row level security;
alter table operandio_api_sync_state enable row level security;
