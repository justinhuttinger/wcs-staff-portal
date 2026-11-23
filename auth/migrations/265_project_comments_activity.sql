-- Projects: comments and a change history per task.
-- Comments: any member can comment on any task, assigned or not. Bodies may
-- carry @mention tokens @[Name](user:<uuid>) (same format as tickets).
-- Authors can edit their own comment; nothing is deleted.
-- Activity: one row per change (status, assignees, dates, priority, title,
-- category, description), written by the API. Existing tasks get a
-- 'created' row so every history starts at the beginning.
-- Service role only (RLS on, no policies). Idempotent.

create table if not exists project_task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references project_tasks(id) on delete cascade,
  author_id uuid references staff(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists project_task_comments_task_idx on project_task_comments (task_id, created_at);

create table if not exists project_task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references project_tasks(id) on delete cascade,
  actor_id uuid references staff(id) on delete set null,
  kind text not null check (kind in (
    'created', 'status', 'assigned', 'unassigned', 'due_date', 'start_date',
    'priority', 'title', 'category', 'description'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_task_activity_task_idx on project_task_activity (task_id, created_at);

alter table project_task_comments enable row level security;
alter table project_task_activity enable row level security;

insert into project_task_activity (task_id, actor_id, kind, created_at)
select t.id, t.created_by, 'created', t.created_at
from project_tasks t
where not exists (
  select 1 from project_task_activity a where a.task_id = t.id and a.kind = 'created'
);
