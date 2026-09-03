-- Member app: daily habits.
--
-- A habit is a target the member ticks off once a day (drink 100 oz, sleep 8
-- hours, walk 10,000 steps). Either the member or their coach can set one up.
-- Keyed (member_id, club_number) like the rest of the member app.

create table if not exists public.memberapp_habits (
  id          uuid primary key default gen_random_uuid(),
  member_id   text not null,
  club_number text not null,
  -- kind drives the icon and the level presets; custom is a free-text habit.
  kind        text not null default 'custom'
              check (kind in ('water','sleep','steps','custom')),
  label       text not null,
  -- target/unit are display only ("100 oz"), so they are loose on purpose:
  -- a custom habit like "stretch after every session" has neither.
  target      numeric,
  unit        text,
  position    integer not null default 0,
  is_active   boolean not null default true,
  -- Staff email when a coach set it up, null when the member did. Shown to the
  -- member so a habit they did not choose does not look like their own doing.
  assigned_by text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists memberapp_habits_member_idx
  on public.memberapp_habits (member_id, club_number, is_active, position);
alter table public.memberapp_habits enable row level security;

-- One row per habit per day: its presence IS the tick. Unticking deletes the
-- row rather than storing a false, which keeps the streak query a plain count.
create table if not exists public.memberapp_habit_logs (
  habit_id     uuid not null references public.memberapp_habits(id) on delete cascade,
  performed_on date not null,
  completed_at timestamptz not null default now(),
  primary key (habit_id, performed_on)
);
create index if not exists memberapp_habit_logs_day_idx
  on public.memberapp_habit_logs (habit_id, performed_on desc);
alter table public.memberapp_habit_logs enable row level security;
