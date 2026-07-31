-- Courts and Pool schedules.
--
-- Unlike Group X these do NOT come from ABC. We own the events outright, so
-- this is the source of truth rather than a layer over someone else's calendar.
--
-- Deliberately generic: `facility` is a slug ('courts', 'pool'), so adding a
-- third facility later is a config line rather than another table and another
-- set of endpoints.
--
-- staff_name is nullable. A lap swim or open gym slot has no instructor, and
-- forcing one would mean inventing names to satisfy the schema.
--
-- This repo has no migration runner. Apply by hand to prod Supabase after merge.

create table if not exists facility_series (
  id                uuid primary key default gen_random_uuid(),
  club_number       text not null,
  facility          text not null,
  title             text not null,
  staff_name        text,
  weekdays          smallint[] not null,   -- 0=Sun .. 6=Sat
  start_time        time not null,         -- club-local
  duration_minutes  int not null,
  starts_on         date not null,
  ends_on           date not null,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  canceled_at       timestamptz,
  canceled_by       text
);

create index if not exists facility_series_club_idx
  on facility_series (club_number, facility, starts_on, ends_on);

create table if not exists facility_events (
  id                uuid primary key default gen_random_uuid(),
  club_number       text not null,
  facility          text not null,
  title             text not null,
  staff_name        text,
  -- Naive club-local "YYYY-MM-DD HH:mm:ss", matching how ABC timestamps are
  -- stored elsewhere in this codebase. A wall clock in a gym is local time;
  -- storing UTC here would mean converting twice for no benefit.
  starts_at_local   text not null,
  duration_minutes  int not null,
  series_id         uuid references facility_series(id) on delete set null,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  canceled_at       timestamptz,
  canceled_by       text
);

-- The board reads one club + facility over a date window, and the window is a
-- string prefix range on starts_at_local.
create index if not exists facility_events_lookup_idx
  on facility_events (club_number, facility, starts_at_local);

-- The portal DB is 100% service-role. Every public table gets RLS enabled with
-- no policy, so a leaked anon key reads nothing.
alter table facility_series enable row level security;
alter table facility_events enable row level security;
