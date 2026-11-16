-- Hub Suggestions (email): inbox mail that asks the owner for something
-- becomes a suggested task. One open suggestion per Gmail thread; mail Claude
-- reads as "not a request" is kept as skipped so he can rescue it. Also: the
-- messages already processed, muted senders, the scan cursor, reply-all
-- addresses on task people, and files pulled in from an asking email.
-- Service role only. Idempotent.

create table if not exists hub_suggestions (
  id uuid primary key default gen_random_uuid(),
  owner_staff_id uuid not null references staff(id) on delete cascade,
  source text not null check (source in ('email', 'text')),
  status text not null default 'open' check (status in ('open', 'added', 'dismissed', 'skipped')),
  gmail_thread_id text,
  message_ids text[] not null default '{}',
  from_name text,
  from_email text,
  cc_emails text[] not null default '{}',
  subject text,
  snippet text,
  summary text,
  guess jsonb not null default '{}',
  received_at timestamptz not null,
  last_message_at timestamptz,
  you_replied boolean not null default false,
  seen boolean not null default false,
  task_id uuid references hub_tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hub_suggestions_open_thread_idx
  on hub_suggestions (owner_staff_id, gmail_thread_id)
  where status = 'open' and gmail_thread_id is not null;
create index if not exists hub_suggestions_owner_idx on hub_suggestions (owner_staff_id, status, received_at);
alter table hub_suggestions enable row level security;

create table if not exists hub_suggest_seen (
  owner_staff_id uuid not null references staff(id) on delete cascade,
  message_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_staff_id, message_id)
);
alter table hub_suggest_seen enable row level security;

create table if not exists hub_muted_senders (
  owner_staff_id uuid not null references staff(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (owner_staff_id, email)
);
alter table hub_muted_senders enable row level security;

alter table hub_owner_state add column if not exists suggest_cursor timestamptz;
alter table hub_task_people add column if not exists cc_emails text[] not null default '{}';

create table if not exists hub_task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references hub_tasks(id) on delete cascade,
  gmail_message_id text not null,
  gmail_part_id text not null,
  file_name text,
  mime text,
  size_bytes integer,
  too_large boolean not null default false,
  storage_path text,
  drive_file_id text,
  drive_url text,
  created_at timestamptz not null default now()
);
create unique index if not exists hub_task_files_gmail_idx on hub_task_files (task_id, gmail_message_id, gmail_part_id);
alter table hub_task_files enable row level security;
