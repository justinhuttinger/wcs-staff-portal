-- Coaching: programs, templates and workout logs on the exercise library.
--
-- Replaces the first-pass member-app training tables (185-188) with one
-- Kahunas-style tree used by BOTH templates and client programs:
--
--   memberapp_programs        kind = 'template' (a library entry) or 'client'
--     memberapp_program_days  Push A, Pull A, Legs A...
--       memberapp_program_items  one exercise row in Warm up / Workout / Cool down
--
-- Prod holds only test data in the old tables (1 training member, 1 program,
-- 11 sessions), so they are dropped and replaced in place rather than
-- migrated. The member app's Training tab is expected to break until Coaching
-- PR 4 ships its new screens.
--
-- Saving a program is a diff (auth/src/lib/coachingPrograms.js planTreeDiff):
-- days and items keep their ids across edits, so a set log's program_item_id
-- survives a coach fixing a typo. Logs also store the library exercise_id and
-- a name snapshot, so "last time" and progress work across programs, and a
-- deleted item never loses what was lifted.
--
-- Depends on 238 (memberapp_exercises).

drop table if exists public.memberapp_set_logs cascade;
drop table if exists public.memberapp_workout_sessions cascade;
drop table if exists public.memberapp_program_exercises cascade;
drop table if exists public.memberapp_program_days cascade;
drop table if exists public.memberapp_programs cascade;
drop table if exists public.memberapp_template_exercises cascade;
drop table if exists public.memberapp_template_days cascade;
drop table if exists public.memberapp_program_templates cascade;

create table public.memberapp_programs (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('template','client')),
  -- Client programs only; a template belongs to nobody.
  member_id          text,
  club_number        text,
  name               text not null,
  overview           text,
  tags               text[] not null default '{}',
  -- Template facets for the library filters. Free text, like the old table.
  goal               text,
  level              text,
  days_per_week      integer check (days_per_week is null or days_per_week between 1 and 7),
  equipment          text,
  coach_staff_id     uuid,
  -- Templates: null = the shared WCS library (managers+ edit), otherwise the
  -- trainer whose private template this is. Unused on client programs.
  owner_staff_id     uuid,
  -- The template a client program was assigned from. Copies are independent:
  -- editing or deleting the template never touches them.
  source_template_id uuid references public.memberapp_programs(id) on delete set null,
  -- Scheduling as before: null start = live now, a future start = the next
  -- block, a past end = finished. Client programs are archived (is_active
  -- false), never deleted, so logged history keeps its program.
  starts_on          date,
  ends_on            date,
  is_active          boolean not null default true,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint memberapp_programs_kind_owner check (
    (kind = 'template' and member_id is null and club_number is null)
    or (kind = 'client' and member_id is not null and club_number is not null)
  ),
  constraint memberapp_programs_date_range
    check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index memberapp_programs_member_idx
  on public.memberapp_programs (member_id, club_number, is_active);
create index memberapp_programs_kind_owner_idx
  on public.memberapp_programs (kind, owner_staff_id);
create index memberapp_programs_source_idx
  on public.memberapp_programs (source_template_id) where source_template_id is not null;
alter table public.memberapp_programs enable row level security;

create table public.memberapp_program_days (
  id           uuid primary key default gen_random_uuid(),
  program_id   uuid not null references public.memberapp_programs(id) on delete cascade,
  position     integer not null default 0,
  name         text not null,
  -- Kahunas "Instructions": what the coach wants said about the whole day.
  instructions text
);
create index memberapp_program_days_program_idx
  on public.memberapp_program_days (program_id, position);
alter table public.memberapp_program_days enable row level security;

-- reps/weight/rir stay TEXT: coaches write "8-12", "AMRAP", "30s", "70%".
-- sets and rest are numbers because the app counts them (set rows, the timer).
create table public.memberapp_program_items (
  id             uuid primary key default gen_random_uuid(),
  day_id         uuid not null references public.memberapp_program_days(id) on delete cascade,
  section        text not null check (section in ('warmup','workout','cooldown')),
  position       integer not null default 0,
  -- Neighbouring items in one section sharing a group render as A1/A2.
  -- Null = a standalone exercise.
  superset_group text,
  exercise_id    uuid not null references public.memberapp_exercises(id),
  sets           integer check (sets is null or sets between 0 and 20),
  reps           text,
  weight         text,
  rir            text,
  rest_seconds   integer check (rest_seconds is null or rest_seconds between 0 and 3600),
  notes          text
);
create index memberapp_program_items_day_idx
  on public.memberapp_program_items (day_id, position);
create index memberapp_program_items_exercise_idx
  on public.memberapp_program_items (exercise_id);
alter table public.memberapp_program_items enable row level security;

create table public.memberapp_workout_sessions (
  id               uuid primary key default gen_random_uuid(),
  member_id        text not null,
  club_number      text not null,
  program_id       uuid references public.memberapp_programs(id) on delete set null,
  day_id           uuid references public.memberapp_program_days(id) on delete set null,
  performed_on     date not null default (now() at time zone 'America/Los_Angeles')::date,
  started_at       timestamptz default now(),
  completed_at     timestamptz,
  duration_seconds integer,
  notes            text,
  -- Staff email when a coach logged it on the floor; null = the member did.
  logged_by        text
);
create index memberapp_sessions_member_idx
  on public.memberapp_workout_sessions (member_id, club_number, performed_on desc);
alter table public.memberapp_workout_sessions enable row level security;

create table public.memberapp_set_logs (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.memberapp_workout_sessions(id) on delete cascade,
  -- The prescribed row this set was for. Null once that row is removed from
  -- the program, or for an exercise added or swapped in mid-session.
  program_item_id uuid references public.memberapp_program_items(id) on delete set null,
  exercise_id     uuid not null references public.memberapp_exercises(id),
  -- Snapshot, so history reads right even if the library row is renamed.
  exercise_name   text not null,
  -- Order of an extra (added/swapped) exercise within the session.
  extra_position  integer,
  set_number      integer not null,
  reps            integer,
  weight          numeric(7,2),
  rir             numeric(3,1),
  note            text,
  created_at      timestamptz not null default now()
);
create unique index memberapp_set_logs_item_uidx
  on public.memberapp_set_logs (session_id, program_item_id, set_number)
  where program_item_id is not null;
create unique index memberapp_set_logs_extra_uidx
  on public.memberapp_set_logs (session_id, extra_position, set_number)
  where extra_position is not null;
create index memberapp_set_logs_session_idx
  on public.memberapp_set_logs (session_id);
-- "Last time" and per-exercise progress.
create index memberapp_set_logs_exercise_idx
  on public.memberapp_set_logs (exercise_id, created_at desc);
alter table public.memberapp_set_logs enable row level security;
