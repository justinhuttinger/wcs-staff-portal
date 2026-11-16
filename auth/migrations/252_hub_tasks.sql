-- Hub: the owner's private task tracker (first Hub section). Tasks carry a
-- category, priority, due date, clubs and the people the owner is waiting on;
-- each person has their own Gmail thread. Existing Follow-ups are copied in
-- (one task + one person each), keyed by legacy_follow_up_id so a re-run copies
-- nothing twice. Owner-only via the API. Service role only. Idempotent.

create table if not exists hub_categories (
  id uuid primary key default gen_random_uuid(),
  owner_staff_id uuid not null references staff(id) on delete cascade,
  name text not null,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists hub_categories_owner_name_idx
  on hub_categories (owner_staff_id, lower(name));

create table if not exists hub_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_staff_id uuid not null references staff(id) on delete cascade,
  category_id uuid references hub_categories(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  due_date date,
  clubs text[] not null default '{}',
  status text not null default 'todo' check (status in ('todo', 'waiting', 'done', 'dropped')),
  completed_at timestamptz,
  -- created_at is the task's "assigned date": set once, never edited.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_follow_up_id uuid unique
);

create index if not exists hub_tasks_owner_status_idx on hub_tasks (owner_staff_id, status);

create table if not exists hub_task_people (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references hub_tasks(id) on delete cascade,
  name text not null,
  email text not null,
  state text not null default 'new' check (state in ('new', 'waiting', 'replied', 'delivered')),
  subject text,
  gmail_thread_id text,
  first_message_id_header text,
  last_sent_at timestamptz,
  last_reply_at timestamptz,
  last_reply_snippet text,
  reply_seen boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists hub_task_people_task_email_idx on hub_task_people (task_id, lower(email));

create table if not exists hub_task_messages (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references hub_task_people(id) on delete cascade,
  kind text not null check (kind in ('initial', 'nudge', 'ask')),
  subject text not null,
  body text not null,
  gmail_message_id text,
  sent_at timestamptz not null default now()
);

create index if not exists hub_task_messages_person_idx on hub_task_messages (person_id, sent_at);

alter table hub_categories enable row level security;
alter table hub_tasks enable row level security;
alter table hub_task_people enable row level security;
alter table hub_task_messages enable row level security;

-- Copy Follow-ups in. Only rows inserted by THIS run flow on to people and
-- messages, so running the file again adds nothing.
with new_tasks as (
  insert into hub_tasks (owner_staff_id, title, description, due_date, status,
                         completed_at, created_at, updated_at, legacy_follow_up_id)
  select p.owner_staff_id, p.title, p.details, p.due_date,
         case p.status when 'done' then 'done' when 'cancelled' then 'dropped' else 'waiting' end,
         p.completed_at, p.created_at, p.updated_at, p.id
  from follow_up_projects p
  on conflict (legacy_follow_up_id) do nothing
  returning id, legacy_follow_up_id
),
new_people as (
  insert into hub_task_people (task_id, name, email, state, subject, gmail_thread_id,
                               first_message_id_header, last_sent_at, last_reply_at,
                               last_reply_snippet, reply_seen, created_at)
  select t.id, p.recipient_name, p.recipient_email,
         case when p.status = 'replied' then 'replied' else 'waiting' end,
         p.subject, p.gmail_thread_id, p.first_message_id_header, p.last_sent_at,
         p.last_reply_at, p.last_reply_snippet, p.status <> 'replied', p.created_at
  from new_tasks t
  join follow_up_projects p on p.id = t.legacy_follow_up_id
  returning id, task_id
)
insert into hub_task_messages (person_id, kind, subject, body, gmail_message_id, sent_at)
select np.id, m.kind, m.subject, m.body, m.gmail_message_id, m.sent_at
from new_people np
join new_tasks t on t.id = np.task_id
join follow_up_messages m on m.project_id = t.legacy_follow_up_id;
