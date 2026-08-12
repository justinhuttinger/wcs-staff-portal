-- Ticket assignment + @mentions.
--
-- Two related capabilities layered onto the native ticketing module:
--
--   * Assignment already exists as tickets.assigned_to (added in 100). This
--     migration makes assignment a first-class, notifiable event by adding a
--     watcher and a mention row when it happens, so the assignee has a durable
--     record of "this was handed to me" independent of the free-text timeline.
--
--   * @mentions in ticket comments. A comment body stores mentions as stable
--     tokens — @[Display Name](user:<uuid>) — so a person's display name can
--     change without rewriting history. On save, newly-added mentions are
--     recorded here and the mentioned staff become watchers.
--
-- Both feed a single notify seam (src/services/ticketNotify.js). Today that
-- seam records intent to chat_ticket_notifications; the Google Chat DM bridge
-- (see the ecosystem spec) attaches there later without touching this schema.
--
-- Tables are service-role only (RLS enabled, no policies), matching the
-- 035 / 078 / 100 convention. All access is brokered by src/routes/ticketing.js.

-- One row per (ticket, person, source) notification intent. `source` records
-- why the person was pulled in; `comment_id` ties a comment-mention back to its
-- comment so an edit can diff against what was already notified. notified_at /
-- notify_channel / notify_error capture the delivery outcome from the seam.
create table if not exists ticket_mentions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  comment_id uuid references ticket_comments(id) on delete cascade,
  mentioned_user_id uuid not null references staff(id),
  actor_id uuid references staff(id),
  source text not null default 'comment'
    check (source in ('comment', 'body', 'assignment')),
  notified_at timestamptz,
  notify_channel text,            -- 'chat' | null (pending / failed)
  notify_error text,
  chat_message_name text,         -- "spaces/X/messages/Y" of the DM we sent, if any
  created_at timestamptz not null default now()
);
create index if not exists idx_ticket_mentions_ticket on ticket_mentions (ticket_id, created_at);
create index if not exists idx_ticket_mentions_user on ticket_mentions (mentioned_user_id, created_at desc);
create index if not exists idx_ticket_mentions_comment on ticket_mentions (comment_id);

-- Watchers: everyone kept in the loop on a ticket. `reason` is why they were
-- added; a person may qualify under several reasons but we keep the first
-- (the unique constraint collapses re-adds). Used to scope an "assigned to /
-- watching me" view and, later, who receives passive Chat updates.
create table if not exists ticket_watchers (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  staff_user_id uuid not null references staff(id),
  reason text not null default 'manual'
    check (reason in ('creator', 'assignee', 'mentioned', 'manual')),
  created_at timestamptz not null default now(),
  unique (ticket_id, staff_user_id)
);
create index if not exists idx_ticket_watchers_staff on ticket_watchers (staff_user_id, created_at desc);

-- The notify seam's outbox / audit. One row per delivery attempt against a
-- mention. Kept separate from ticket_mentions so retries and the eventual
-- Chat-bridge payloads have somewhere to live without bloating the mention row.
create table if not exists chat_ticket_notifications (
  id uuid primary key default gen_random_uuid(),
  mention_id uuid references ticket_mentions(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,
  actor_id uuid references staff(id),
  target_user_id uuid not null references staff(id),
  kind text not null,             -- 'assigned' | 'mentioned_comment' | 'mentioned_body'
  channel text,                   -- delivery channel actually used, null while pending
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  payload jsonb not null default '{}'::jsonb,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_chat_ticket_notif_status on chat_ticket_notifications (status, created_at);
create index if not exists idx_chat_ticket_notif_ticket on chat_ticket_notifications (ticket_id, created_at);

drop trigger if exists trg_chat_ticket_notif_touch on chat_ticket_notifications;
create trigger trg_chat_ticket_notif_touch before update on chat_ticket_notifications
  for each row execute function ticketing_touch_updated_at();

alter table ticket_mentions enable row level security;
alter table ticket_watchers enable row level security;
alter table chat_ticket_notifications enable row level security;

-- Backfill watchers for existing tickets so the "watching me" view isn't empty
-- on rollout: every submitter watches their own ticket, every current assignee
-- watches theirs. Idempotent via the unique (ticket_id, staff_user_id).
insert into ticket_watchers (ticket_id, staff_user_id, reason)
  select id, submitter_id, 'creator' from tickets where submitter_id is not null
on conflict (ticket_id, staff_user_id) do nothing;

insert into ticket_watchers (ticket_id, staff_user_id, reason)
  select id, assigned_to, 'assignee' from tickets where assigned_to is not null
on conflict (ticket_id, staff_user_id) do nothing;
