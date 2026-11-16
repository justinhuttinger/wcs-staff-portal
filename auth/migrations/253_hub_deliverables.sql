-- Hub deliverables: what the owner expects back on a task (a photo, a file,
-- copy), owed by one attached person, with one slot per club (one club-less
-- slot when the task has no clubs). Files live in the private hub-task-files
-- storage bucket. Each person gets one no-login upload token. Service role
-- only. Idempotent.

create table if not exists hub_deliverables (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references hub_tasks(id) on delete cascade,
  person_id uuid references hub_task_people(id) on delete set null,
  name text not null,
  kind text not null check (kind in ('image', 'file', 'text')),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists hub_deliverables_task_idx on hub_deliverables (task_id);

create table if not exists hub_slots (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references hub_deliverables(id) on delete cascade,
  club text,
  created_at timestamptz not null default now()
);

create unique index if not exists hub_slots_deliverable_club_idx
  on hub_slots (deliverable_id, coalesce(club, ''));

create table if not exists hub_slot_items (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references hub_slots(id) on delete cascade,
  storage_path text,
  file_name text,
  mime text,
  size_bytes integer,
  text_body text,
  source text not null check (source in ('owner', 'upload', 'email')),
  gmail_message_id text,
  gmail_attachment_id text,
  is_new boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists hub_slot_items_slot_idx on hub_slot_items (slot_id);
create unique index if not exists hub_slot_items_gmail_idx
  on hub_slot_items (gmail_message_id, gmail_attachment_id)
  where gmail_message_id is not null;

create table if not exists hub_upload_tokens (
  token text primary key,
  person_id uuid not null unique references hub_task_people(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table hub_deliverables enable row level security;
alter table hub_slots enable row level security;
alter table hub_slot_items enable row level security;
alter table hub_upload_tokens enable row level security;
