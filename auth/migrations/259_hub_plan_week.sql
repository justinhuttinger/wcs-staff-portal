-- Hub "Plan my week": an optional Time needed per task (overrides Claude's
-- estimate) and the calendar events the planner created, so each run can
-- clear its own future blocks before rebuilding. Service role only.
-- Idempotent.

alter table hub_tasks add column if not exists minutes_override integer
  check (minutes_override is null or minutes_override in (30, 60, 90, 120, 180));

create table if not exists hub_plan_events (
  event_id text primary key,
  owner_staff_id uuid not null references staff(id) on delete cascade,
  ref_kind text not null check (ref_kind in ('task', 'ticket')),
  ref_id uuid not null,
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists hub_plan_events_owner_idx on hub_plan_events (owner_staff_id, starts_at);

alter table hub_plan_events enable row level security;
