-- Day One PT program generation jobs (migrated from standalone dayone service).
-- Replaces the ephemeral on-disk PDF cache + lastGeneratedPdf global var.
create table if not exists public.pt_programs (
  id            uuid primary key default gen_random_uuid(),
  contact_id    text not null,
  contact_name  text,
  contact_email text,
  location_id   text,
  club_code     text,
  trainer_name  text,
  abc_member_id text,
  status        text not null default 'pending',
  progress      text,
  program_json  jsonb,
  pdf_path      text,
  emailed       boolean not null default false,
  uploaded_abc  boolean not null default false,
  error_message text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- "latest job for this contact" lookup used by the SSE success page.
create index if not exists pt_programs_contact_created_idx
  on public.pt_programs (contact_id, created_at desc);

-- Portal convention: RLS on, no policy (service-role-only; frontend never reads this).
alter table public.pt_programs enable row level security;
