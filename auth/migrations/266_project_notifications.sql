-- Projects: audit log of Google Chat DMs sent for task events (assigned,
-- comment, mentioned, complete). One row per recipient per event, with
-- whether it went from the actor's own account or the portal account, and
-- why it failed or was skipped. Service role only. Idempotent.

create table if not exists project_notifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references project_tasks(id) on delete cascade,
  actor_id uuid references staff(id) on delete set null,
  target_id uuid references staff(id) on delete set null,
  kind text not null check (kind in ('assigned', 'comment', 'mentioned', 'complete')),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  sent_as text check (sent_as in ('actor', 'system')),
  message text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists project_notifications_task_idx on project_notifications (task_id, created_at);

alter table project_notifications enable row level security;
