-- Projects: the team task tracker (separate from the owner-only Hub).
-- Access is a members list managed in Admin > Projects. Members see every
-- task, can create tasks and assign them to any member. Tasks are never
-- deleted: they are marked Skipped (with an optional reason) and can be
-- restored. A task's created_at is its "assigned date" and is never edited.
-- Service role only (RLS on, no policies); the API enforces membership.
-- Idempotent.

create table if not exists project_members (
  staff_id uuid primary key references staff(id) on delete cascade,
  added_by uuid references staff(id) on delete set null,
  added_at timestamptz not null default now()
);

create table if not exists project_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists project_categories_name_idx
  on project_categories (lower(name));

create table if not exists project_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category_id uuid references project_categories(id) on delete set null,
  priority text not null default 'medium'
    check (priority in ('urgent', 'high', 'medium', 'low')),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'complete', 'skipped')),
  -- Optional; only the Gantt uses it. Without it a bar runs from created_at.
  start_date date,
  due_date date,
  -- Board order within a status column (set by drag in a later PR).
  sort_order double precision not null default 0,
  skip_reason text,
  completed_at timestamptz,
  completed_by uuid references staff(id) on delete set null,
  created_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_tasks_status_idx on project_tasks (status);
create index if not exists project_tasks_due_idx on project_tasks (due_date);

create table if not exists project_task_assignees (
  task_id uuid not null references project_tasks(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  assigned_by uuid references staff(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (task_id, staff_id)
);

create index if not exists project_task_assignees_staff_idx on project_task_assignees (staff_id);

alter table project_members enable row level security;
alter table project_categories enable row level security;
alter table project_tasks enable row level security;
alter table project_task_assignees enable row level security;
