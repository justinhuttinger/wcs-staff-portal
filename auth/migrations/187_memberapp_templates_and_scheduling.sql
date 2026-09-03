-- Reusable program templates, and a start date so a program can be built
-- ahead of time and take over on a chosen day.

create table if not exists public.memberapp_program_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  goal          text,          -- strength, hypertrophy, fat loss, ...
  level         text,          -- beginner, intermediate, advanced
  days_per_week integer,
  equipment     text,          -- full gym, dumbbells only, bodyweight, ...
  description   text,
  -- Free tags so search can match words that are not in the name.
  tags          text[] not null default '{}',
  is_active     boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists memberapp_templates_active_idx
  on public.memberapp_program_templates (is_active, name);
alter table public.memberapp_program_templates enable row level security;

create table if not exists public.memberapp_template_days (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.memberapp_program_templates(id) on delete cascade,
  position    integer not null default 0,
  name        text not null
);
create index if not exists memberapp_template_days_idx
  on public.memberapp_template_days (template_id, position);
alter table public.memberapp_template_days enable row level security;

-- Mirrors memberapp_program_exercises exactly, so assigning a template is a
-- straight copy with no field mapping to get wrong.
create table if not exists public.memberapp_template_exercises (
  id           uuid primary key default gen_random_uuid(),
  day_id       uuid not null references public.memberapp_template_days(id) on delete cascade,
  position     integer not null default 0,
  name         text not null,
  sets         text,
  reps         text,
  weight       text,
  rest_seconds integer check (rest_seconds is null or (rest_seconds >= 0 and rest_seconds <= 3600)),
  notes        text
);
create index if not exists memberapp_template_exercises_idx
  on public.memberapp_template_exercises (day_id, position);
alter table public.memberapp_template_exercises enable row level security;

-- Null means "in effect now". A future date makes the program scheduled: the
-- member app picks the newest program whose start date has arrived, so a
-- coach can build next block without disturbing the current one.
alter table public.memberapp_programs
  add column if not exists starts_on date,
  add column if not exists template_id uuid references public.memberapp_program_templates(id) on delete set null;

create index if not exists memberapp_programs_schedule_idx
  on public.memberapp_programs (member_id, club_number, is_active, starts_on desc);

comment on column public.memberapp_programs.starts_on is
  'Date this program takes over. Null means immediately. A future date is a scheduled program the member cannot see yet.';
