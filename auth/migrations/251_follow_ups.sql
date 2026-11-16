-- Follow-ups: the owner's personal tracker for things he is waiting on from
-- people. Each project starts with one email sent from his own Gmail; every
-- nudge is a reply in that same thread. Owner-only (FOLLOW_UPS_EMAILS on the
-- API). Service role only. Idempotent: safe to re-run.

create table if not exists follow_up_projects (
  id uuid primary key default gen_random_uuid(),
  owner_staff_id uuid not null references staff(id) on delete cascade,
  recipient_name text not null,
  recipient_email text not null,
  title text not null,
  details text,
  due_date date,
  -- active: waiting on them. replied: they answered, owner to review.
  -- done: owner closed it. cancelled: dropped.
  status text not null default 'active'
    check (status in ('active', 'replied', 'done', 'cancelled')),
  subject text not null,
  gmail_thread_id text,
  -- RFC Message-ID of the first email, so nudges thread in every mail client.
  first_message_id_header text,
  last_sent_at timestamptz,
  nudge_count integer not null default 0,
  last_reply_at timestamptz,
  last_reply_snippet text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists follow_up_projects_owner_status_idx
  on follow_up_projects (owner_staff_id, status);

create table if not exists follow_up_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references follow_up_projects(id) on delete cascade,
  kind text not null check (kind in ('initial', 'nudge')),
  subject text not null,
  body text not null,
  gmail_message_id text,
  sent_at timestamptz not null default now()
);

create index if not exists follow_up_messages_project_idx
  on follow_up_messages (project_id, sent_at);

alter table follow_up_projects enable row level security;
alter table follow_up_messages enable row level security;
