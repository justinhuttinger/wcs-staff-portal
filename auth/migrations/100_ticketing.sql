-- Native ticketing module — internal ClickUp-forms replacement.
-- Admins build ticket *types* (a schema of fields, like the Form Builder),
-- staff submit tickets against an active type, and admins track them through
-- an Open -> In Progress -> Complete workflow with a comment thread and file
-- attachments.
--
-- Tables are service-role only (RLS enabled, no policies), matching the
-- migration 035 / 078 convention. All access is brokered by src/routes/ticketing.js.

-- A ticket type is a reusable template: title, icon, and a jsonb field schema
-- (same shape the Form Builder uses). `active` gates whether staff can see /
-- submit it — inactive types are hidden from submitters but kept for history.
create table if not exists ticket_types (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  icon text,                                  -- heroicon path string (optional)
  schema jsonb not null default '[]'::jsonb,  -- array of field definitions
  active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ticket_types_active on ticket_types (active, sort_order);

-- A submitted ticket. `data` holds the answers keyed by field id (jsonb, same
-- convention as form_submissions). status drives the progress board.
create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references ticket_types(id),
  title text not null,
  data jsonb not null default '{}'::jsonb,
  submitter_id uuid references staff(id),
  location_id uuid references locations(id),
  status text not null default 'open'
    check (status in ('open','in_progress','complete','closed')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_tickets_status on tickets (status, created_at desc);
create index if not exists idx_tickets_type on tickets (type_id, created_at desc);
create index if not exists idx_tickets_submitter on tickets (submitter_id, created_at desc);

-- Progress thread. `system` rows are status-change / assignment notes written
-- by the app (not a person typing) so the timeline reads as an activity log.
create table if not exists ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_id uuid references staff(id),
  body text not null,
  system boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_ticket_comments_ticket on ticket_comments (ticket_id, created_at);

-- Files attached to a ticket (on submit) or to a specific comment. Stored in
-- the private Supabase Storage bucket 'ticket-attachments'; the app serves
-- them through short-lived signed URLs.
create table if not exists ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  comment_id uuid references ticket_comments(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid references staff(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_ticket_attachments_ticket on ticket_attachments (ticket_id, created_at);

-- Keep updated_at fresh on ticket_types / tickets.
create or replace function ticketing_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ticket_types_touch on ticket_types;
create trigger trg_ticket_types_touch before update on ticket_types
  for each row execute function ticketing_touch_updated_at();

drop trigger if exists trg_tickets_touch on tickets;
create trigger trg_tickets_touch before update on tickets
  for each row execute function ticketing_touch_updated_at();

alter table ticket_types enable row level security;
alter table tickets enable row level security;
alter table ticket_comments enable row level security;
alter table ticket_attachments enable row level security;

-- RBAC: make the tool grantable, but admin-only for now (matches the Forms
-- module rollout). Admins can widen this later from the RBAC screens.
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('ticketing', 'Ticketing', 'Tools', 'admin')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
values ('admin', 'ticketing', true)
on conflict (role, tool_key) do update set visible = true;

-- NOTE: the private Storage bucket 'ticket-attachments' is created idempotently
-- at runtime by src/routes/ticketing.js (ensureBucket) on the first upload, so
-- no manual Supabase dashboard step is required.
