-- 211: WCS Save. Our own member cancellation + retention flow (Click2Save
-- replacement). The member-facing side is the wcs-save Cloudflare Worker, which
-- reads settings/reasons/offers and writes save_requests with the service key.
-- The portal only edits config and reviews requests (Admin -> Save Offers).
-- Design: wcs-save repo docs/design.md.

-- One row. Member-facing copy lives here so wording changes need no deploy.
create table if not exists save_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  require_email_code boolean not null default true,
  max_offers_shown int not null default 2 check (max_offers_shown between 0 and 5),
  -- What happens when the member owes money at cancel time and no payment
  -- provider is wired up: 'staff' = record it for staff to finish,
  -- 'block' = tell the member to call the club. 'charge' is reserved for the
  -- Stripe provider and rejected by the Worker until that exists.
  owed_balance_mode text not null default 'staff'
    check (owed_balance_mode in ('staff', 'block', 'charge')),
  intro_heading text not null default 'Manage your membership',
  intro_body text not null default 'Find your membership to cancel or see options to keep it.',
  saved_heading text not null default 'You are all set',
  saved_body text not null default 'Your offer has been applied. We are glad you are staying.',
  cancelled_heading text not null default 'Your cancellation is submitted',
  cancelled_body text not null default 'You will get a confirmation email. We hope to see you again.',
  staff_heading text not null default 'We received your request',
  staff_body text not null default 'A team member will contact you within 2 business days to finish up.',
  staff_notify_emails text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table save_settings enable row level security;
insert into save_settings (id) values (1) on conflict (id) do nothing;

-- Cancel reasons the member picks from. abc_cancel_code is sent to ABC as
-- cancelCodeId, so it must be one of the club's codes from
-- GET /{club}/clubs/agreements/canceldetails.
create table if not exists save_reasons (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  abc_cancel_code text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table save_reasons enable row level security;

-- Seed only into an empty table, so re-running never duplicates. Codes are
-- the ones configured at Salem (30935) on 2026-09-25.
insert into save_reasons (label, abc_cancel_code, sort_order)
select * from (values
  ('I''m moving', 'CMO', 10),
  ('Medical reasons', 'CDO', 20),
  ('It''s too expensive right now', 'CFH', 30),
  ('I''m not using it enough', 'CNU', 40),
  ('I joined another gym', 'CJC', 50),
  ('I work out at home now', 'CHG', 60),
  ('I''m unhappy with the facility', 'CSF', 70),
  ('I have a billing issue', 'CUB', 80),
  ('Military service', 'CMI', 90)
) as seed(label, abc_cancel_code, sort_order)
where not exists (select 1 from save_reasons);

-- Save offers. config by offer_type:
--   dues_discount: { "percent_off": 1-100 } or { "amount_off": > 0 }, plus { "invoices": 1-12 }
--   freeze:        { "months": 1-12, "fee": >= 0 }
--   perk:          { "staff_instructions": text }
-- Empty reason_ids / club_numbers mean "all".
create table if not exists save_offers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  offer_type text not null check (offer_type in ('dues_discount', 'freeze', 'perk')),
  headline text not null,
  description text,
  fine_print text,
  config jsonb not null default '{}'::jsonb,
  reason_ids uuid[] not null default '{}',
  club_numbers text[] not null default '{}',
  priority int not null default 100,
  active boolean not null default false,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table save_offers enable row level security;
create index if not exists idx_save_offers_active on save_offers (active, priority);

-- One row per member attempt. abc_actions is an append-only log of every ABC
-- write (or simulated write when dry_run) the Worker made for this request.
create table if not exists save_requests (
  id uuid primary key default gen_random_uuid(),
  club_number text not null,
  member_id text not null,
  member_name text,
  email text,
  verified_at timestamptz,
  agreement jsonb,
  reason_id uuid references save_reasons(id) on delete set null,
  reason_label text,
  reason_note text,
  offers_shown uuid[] not null default '{}',
  offer_id uuid references save_offers(id) on delete set null,
  offer_snapshot jsonb,
  outcome text not null default 'in_progress'
    check (outcome in ('in_progress', 'saved', 'cancelled', 'needs_staff', 'abandoned', 'failed')),
  staff_reason text,
  cancel_date date,
  owed jsonb,
  abc_actions jsonb not null default '[]'::jsonb,
  dry_run boolean not null default true,
  request_ip text,
  completed_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table save_requests enable row level security;
create index if not exists idx_save_requests_created on save_requests (created_at desc);
create index if not exists idx_save_requests_outcome on save_requests (outcome, created_at desc);
create index if not exists idx_save_requests_member on save_requests (club_number, member_id);

create table if not exists save_login_codes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references save_requests(id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  request_ip text,
  created_at timestamptz not null default now()
);
alter table save_login_codes enable row level security;
create index if not exists idx_save_login_codes_request on save_login_codes (request_id, created_at desc);
