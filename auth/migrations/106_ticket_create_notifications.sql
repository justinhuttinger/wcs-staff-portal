-- Notify people when a ticket is created, as a Chat DM from a system account.
--
-- Two pieces:
--
-- 1. Per-type recipient list. Assignment and @mention DMs are person-to-person
--    (sent as the actor); a creation notice is different — it comes from the
--    portal itself, so the recipients are configured per ticket TYPE in the
--    builder, next to Handlers. Empty array = notify nobody, which is the
--    default and matches today's behavior.
alter table ticket_types
  add column if not exists notify_on_create_ids uuid[] not null default '{}';

comment on column ticket_types.notify_on_create_ids is
  'Staff ids DM''d when a ticket of this type is created. Empty = no creation notice.';

-- 2. A shared Google token, not tied to any one staff member, so creation
--    notices arrive from noreply@wcstrength.com instead of from whoever
--    happened to submit the ticket. Keyed by purpose so a second system sender
--    can be added later without another table.
--
--    Same shape as staff_google_tokens. Service-role only (RLS on, no
--    policies) — it holds a refresh token and must never be reachable from the
--    browser.
create table if not exists system_google_tokens (
  purpose       text primary key,
  email         text not null,
  access_token  text,
  refresh_token text not null,
  expires_at    timestamptz,
  scope         text,
  connected_by  uuid references staff(id),
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table system_google_tokens enable row level security;

comment on table system_google_tokens is
  'OAuth tokens for portal-owned sender accounts (e.g. purpose=ticket_notifier -> noreply@). Service role only.';
