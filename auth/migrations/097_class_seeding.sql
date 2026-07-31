-- Class seeding.
--
-- WCS Group X classes are free and well attended, but almost nobody books
-- through the ABC app, so a class with 20 people in the room shows 0 booked
-- online. This enrols a small set of house accounts into otherwise-empty
-- classes so the app does not read as "nobody goes to this".
--
-- Three tables:
--   class_seed_accounts  the house accounts, shared across all clubs
--   class_seed_settings  per-club on/off and how many to enrol
--   class_seed_log       every enrolment attempt, so it is auditable and undoable
--
-- The log is the important one. Anything this job puts into ABC has to be
-- traceable and reversible; a background job that writes to member records
-- without a paper trail is not something anyone should have to debug later.
--
-- This repo has no migration runner. Apply by hand to prod Supabase after merge.

create table if not exists class_seed_accounts (
  member_id     text primary key,
  display_name  text not null,
  active        boolean not null default true,
  created_by    text not null,
  created_at    timestamptz not null default now()
);

create table if not exists class_seed_settings (
  club_number  text primary key,
  enabled      boolean not null default false,
  min_count    int not null default 1,
  max_count    int not null default 3,
  updated_by   text not null,
  updated_at   timestamptz not null default now(),
  constraint class_seed_range_sane check (min_count >= 0 and max_count >= min_count)
);

create table if not exists class_seed_log (
  id            uuid primary key default gen_random_uuid(),
  club_number   text not null,
  abc_event_id  text not null,
  member_id     text not null,
  class_name    text,
  event_local   text,
  ok            boolean not null,
  error         text,
  created_at    timestamptz not null default now()
);

-- "Has this account already been put in this class?" is the hot question, both
-- for skipping duplicates and for undoing a night's work.
create unique index if not exists class_seed_log_unique_ok_idx
  on class_seed_log (club_number, abc_event_id, member_id)
  where ok;

create index if not exists class_seed_log_recent_idx
  on class_seed_log (club_number, created_at desc);

-- The portal DB is 100% service-role. Every public table gets RLS enabled with
-- no policy, so a leaked anon key reads nothing.
alter table class_seed_accounts enable row level security;
alter table class_seed_settings enable row level security;
alter table class_seed_log enable row level security;
