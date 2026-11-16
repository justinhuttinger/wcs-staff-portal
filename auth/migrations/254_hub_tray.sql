-- Hub tray: attachments the background Gmail check pulled from a person's
-- replies but could not file on its own (more than one slot could take them).
-- Claude's suggested slot is stored, never applied without the owner's click.
-- Files live in the private hub-task-files bucket. An attachment too large to
-- pull in gets a row with no file (too_large) so the owner opens it in Gmail.
-- hub_gmail_seen records every attachment handled, so a discarded or deleted
-- one never comes back. Keyed on message id + Gmail part id (stable; Gmail's
-- attachmentId changes on every fetch). Service role only. Idempotent.

create table if not exists hub_tray_items (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references hub_task_people(id) on delete cascade,
  gmail_message_id text not null,
  gmail_attachment_id text not null,
  storage_path text,
  too_large boolean not null default false,
  file_name text,
  mime text,
  size_bytes integer,
  suggested_slot_id uuid references hub_slots(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists hub_tray_items_gmail_idx on hub_tray_items (gmail_message_id, gmail_attachment_id);
create index if not exists hub_tray_items_person_idx on hub_tray_items (person_id);

alter table hub_tray_items enable row level security;

create table if not exists hub_gmail_seen (
  person_id uuid not null references hub_task_people(id) on delete cascade,
  message_id text not null,
  part_id text not null,
  created_at timestamptz not null default now(),
  primary key (person_id, message_id, part_id)
);

alter table hub_gmail_seen enable row level security;
