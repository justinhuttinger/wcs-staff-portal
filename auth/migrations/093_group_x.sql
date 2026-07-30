-- Group X scheduler.
--
-- ABC owns WHAT is scheduled; these tables own HOW IT WENT plus the recurring
-- series definition. There is deliberately no local mirror of the class
-- schedule, so nothing needs reconciling when a class is edited inside ABC.
--
-- Attendance is staff-entered rather than read from ABC: of 37 Salem class
-- events in July 2026, 31 had zero members attached and the rest had one, all
-- marked "Did Not Attend". Nobody books classes through ABC.
--
-- This repo has no migration runner. Apply by hand to prod Supabase after merge.

create table if not exists group_x_series (
  id                uuid primary key default gen_random_uuid(),
  club_number       text not null,
  event_type_id     text not null,
  class_name        text not null,
  employee_id       text not null,
  instructor_name   text not null,
  weekdays          smallint[] not null,   -- 0=Sun .. 6=Sat
  start_time        time not null,         -- club-local Pacific
  duration_minutes  int not null,
  training_level_id text,
  starts_on         date not null,
  ends_on           date not null,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  canceled_at       timestamptz,
  canceled_by       text
);

create index if not exists group_x_series_club_dates_idx
  on group_x_series (club_number, starts_on, ends_on);

create table if not exists group_x_class_attendance (
  club_number            text not null,
  abc_event_id           text not null,
  series_id              uuid references group_x_series(id) on delete set null,
  event_timestamp        timestamptz not null,
  event_timestamp_local  text not null,
  event_type_id          text not null,
  class_name             text not null,
  employee_id            text,
  instructor_name        text,
  max_attendees          int,
  headcount              int not null,
  notes                  text,
  recorded_by            text not null,
  recorded_at            timestamptz not null default now(),
  primary key (club_number, abc_event_id)
);

create index if not exists group_x_attendance_club_ts_idx
  on group_x_class_attendance (club_number, event_timestamp);

-- The portal DB is 100% service-role. Every public table gets RLS enabled with
-- no policy, so a leaked anon key reads nothing.
alter table group_x_series enable row level security;
alter table group_x_class_attendance enable row level security;
