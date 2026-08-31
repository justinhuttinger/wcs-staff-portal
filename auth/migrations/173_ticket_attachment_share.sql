-- Public share links for ticket attachments.
--
-- Ticket files live in the PRIVATE Storage bucket 'ticket-attachments' and are
-- only reachable through a 1-hour signed URL minted for a logged-in staff
-- member. That makes a file impossible to hand to anyone outside the portal:
-- an outsider can't get a URL at all, and a pasted one dies within the hour.
--
-- A share token flips one attachment (never the bucket, never the ticket) into
-- a permanently readable file at /public/ticket-file/:token. The bucket stays
-- private; the public route streams the bytes through the API using the
-- service role. Clearing the token revokes the link immediately.
alter table ticket_attachments
  add column if not exists share_token text,
  add column if not exists shared_by uuid references staff(id),
  add column if not exists shared_at timestamptz,
  add column if not exists share_view_count integer not null default 0,
  add column if not exists share_last_viewed_at timestamptz;

-- Token is the whole secret, so it must be unique and fast to look up. Partial
-- index: only shared rows participate, and unshared rows stay NULL rather than
-- colliding with each other.
create unique index if not exists idx_ticket_attachments_share_token
  on ticket_attachments (share_token)
  where share_token is not null;
