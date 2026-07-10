-- auth/migrations/082_impersonation_log.sql
create table if not exists impersonation_log (
  id uuid primary key default gen_random_uuid(),
  actor_staff_id uuid not null references staff(id),
  target_staff_id uuid not null references staff(id),
  started_at timestamptz not null default now()
);
alter table impersonation_log enable row level security;
