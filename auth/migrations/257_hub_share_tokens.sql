-- Hub share links: one no-login link per task that shows everything submitted
-- (files open in the browser, text shown in full), for handing results on.
-- Turning a link off deletes its row. Service role only. Idempotent.

create table if not exists hub_share_tokens (
  token text primary key,
  task_id uuid not null unique references hub_tasks(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table hub_share_tokens enable row level security;
