-- Hub "New" feed: which tickets the owner has opened from the Hub, and when
-- the feed started for him (tickets created before then are never "new").
-- Everything else in the feed reuses existing flags. Service role only.
-- Idempotent.

create table if not exists hub_seen_tickets (
  owner_staff_id uuid not null references staff(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (owner_staff_id, ticket_id)
);

create table if not exists hub_owner_state (
  owner_staff_id uuid primary key references staff(id) on delete cascade,
  feed_since timestamptz not null default now()
);

alter table hub_seen_tickets enable row level security;
alter table hub_owner_state enable row level security;
