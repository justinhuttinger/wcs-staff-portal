-- Member app: PT tier, coach-authored programs, member workout logs,
-- coach<->member messaging, and scheduled broadcast notifications.
--
-- Everything is keyed (member_id, club_number) because that pair is the
-- identity the member app's session already carries; no mapping layer.

-- Tier and coach. A row exists only once someone is touched by staff; absent
-- means basic, so the whole membership does not need seeding.
create table if not exists public.memberapp_members (
  member_id      text not null,
  club_number    text not null,
  tier           text not null default 'basic' check (tier in ('basic','training')),
  coach_staff_id uuid,
  updated_at     timestamptz not null default now(),
  updated_by     text,
  primary key (member_id, club_number)
);
alter table public.memberapp_members enable row level security;

create table if not exists public.memberapp_programs (
  id             uuid primary key default gen_random_uuid(),
  member_id      text not null,
  club_number    text not null,
  name           text not null,
  notes          text,
  coach_staff_id uuid,
  is_active      boolean not null default true,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists memberapp_programs_member_idx
  on public.memberapp_programs (member_id, club_number, is_active);
alter table public.memberapp_programs enable row level security;

create table if not exists public.memberapp_program_days (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.memberapp_programs(id) on delete cascade,
  position   integer not null default 0,
  name       text not null
);
create index if not exists memberapp_program_days_program_idx
  on public.memberapp_program_days (program_id, position);
alter table public.memberapp_program_days enable row level security;

-- sets/reps/weight are TEXT on purpose: coaches write "8-10", "AMRAP",
-- "bodyweight", "135 lb". Forcing numbers here would fight how programs are
-- actually written. The LOG below stores numbers, which is where they matter.
create table if not exists public.memberapp_program_exercises (
  id       uuid primary key default gen_random_uuid(),
  day_id   uuid not null references public.memberapp_program_days(id) on delete cascade,
  position integer not null default 0,
  name     text not null,
  sets     text,
  reps     text,
  weight   text,
  notes    text
);
create index if not exists memberapp_program_exercises_day_idx
  on public.memberapp_program_exercises (day_id, position);
alter table public.memberapp_program_exercises enable row level security;

create table if not exists public.memberapp_workout_sessions (
  id           uuid primary key default gen_random_uuid(),
  member_id    text not null,
  club_number  text not null,
  program_id   uuid references public.memberapp_programs(id) on delete set null,
  day_id       uuid references public.memberapp_program_days(id) on delete set null,
  performed_on date not null default (now() at time zone 'America/Los_Angeles')::date,
  notes        text,
  started_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists memberapp_sessions_member_idx
  on public.memberapp_workout_sessions (member_id, club_number, performed_on desc);
alter table public.memberapp_workout_sessions enable row level security;

create table if not exists public.memberapp_set_logs (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.memberapp_workout_sessions(id) on delete cascade,
  exercise_id uuid references public.memberapp_program_exercises(id) on delete set null,
  set_number  integer not null,
  reps        integer,
  weight      numeric(7,2),
  note        text,
  created_at  timestamptz not null default now(),
  unique (session_id, exercise_id, set_number)
);
create index if not exists memberapp_set_logs_session_idx
  on public.memberapp_set_logs (session_id);
alter table public.memberapp_set_logs enable row level security;

-- One conversation per member per club, so the thread IS the member and no
-- separate threads table is needed.
create table if not exists public.memberapp_messages (
  id             uuid primary key default gen_random_uuid(),
  member_id      text not null,
  club_number    text not null,
  sender         text not null check (sender in ('member','coach')),
  staff_id       uuid,
  body           text not null,
  created_at     timestamptz not null default now(),
  read_at_member timestamptz,
  read_at_coach  timestamptz
);
create index if not exists memberapp_messages_thread_idx
  on public.memberapp_messages (member_id, club_number, created_at desc);
alter table public.memberapp_messages enable row level security;

-- Broadcasts are composed in the portal and delivered by a node-cron job.
-- status moves scheduled -> sending -> sent, and the claim is a conditional
-- update so two dynos cannot both send the same row.
create table if not exists public.memberapp_broadcasts (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text,
  url           text,
  audience      text not null default 'all'
                check (audience in ('all','club','tier','member')),
  club_number   text,
  tier          text check (tier in ('basic','training')),
  member_id     text,
  scheduled_for timestamptz,
  status        text not null default 'scheduled'
                check (status in ('scheduled','sending','sent','failed','canceled')),
  sent_at       timestamptz,
  sent_count    integer not null default 0,
  failed_count  integer not null default 0,
  error         text,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists memberapp_broadcasts_due_idx
  on public.memberapp_broadcasts (status, scheduled_for);
alter table public.memberapp_broadcasts enable row level security;
