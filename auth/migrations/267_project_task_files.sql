-- Projects: files and links on a task.
-- kind 'file': uploaded to the PRIVATE Storage bucket 'project-files' (created
-- by the API on first upload) and opened through 1-hour signed URLs.
-- kind 'link': a Google Drive (or any http/https) link with a title.
-- Nothing is deleted: "Remove" stamps removed_at/removed_by and hides it.
-- History gains file_added / file_removed. Service role only. Idempotent.

create table if not exists project_task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references project_tasks(id) on delete cascade,
  kind text not null check (kind in ('file', 'link')),
  title text not null,
  storage_path text,
  content_type text,
  size_bytes bigint,
  url text,
  added_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references staff(id) on delete set null,
  check ((kind = 'file' and storage_path is not null) or (kind = 'link' and url is not null))
);

create index if not exists project_task_files_task_idx on project_task_files (task_id, created_at);

alter table project_task_files enable row level security;

alter table project_task_activity drop constraint if exists project_task_activity_kind_check;
alter table project_task_activity add constraint project_task_activity_kind_check check (kind in (
  'created', 'status', 'assigned', 'unassigned', 'due_date', 'start_date',
  'priority', 'title', 'category', 'description', 'file_added', 'file_removed'
));
