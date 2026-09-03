-- Member app: diet tracking.
--
-- Not a habit. A habit answers "did you?" once a day; this answers "how much,
-- so far, against what?" all day, so it gets its own tables.
--
-- Depends on 189.

-- Off by default. Either the member turns it on or a coach does.
alter table public.memberapp_members
  add column if not exists nutrition_enabled boolean not null default false;

-- Append-only. A target change writes a NEW row rather than overwriting the old
-- one, so a coach moving someone from 2400 to 2100 in week 6 does not silently
-- rewrite what weeks 1-5 were measured against. The target in effect for a date
-- is the newest row whose effective_from is on or before it.
create table if not exists public.memberapp_nutrition_targets (
  id             uuid primary key default gen_random_uuid(),
  member_id      text not null,
  club_number    text not null,
  calories       numeric,
  protein_g      numeric,
  carbs_g        numeric,
  fat_g          numeric,
  effective_from date not null,
  -- Staff email when a coach set it, null when the member did.
  set_by         text,
  created_at     timestamptz not null default now()
);
create index if not exists memberapp_nutrition_targets_member_idx
  on public.memberapp_nutrition_targets (member_id, club_number, effective_from desc);
alter table public.memberapp_nutrition_targets enable row level security;

-- One row per logged meal. performed_on is the club-local day it was eaten,
-- which is not always the day it was logged: an 11:30pm snack belongs to the
-- day it happened.
create table if not exists public.memberapp_meals (
  id           uuid primary key default gen_random_uuid(),
  member_id    text not null,
  club_number  text not null,
  performed_on date not null,
  slot         text check (slot in ('breakfast','lunch','dinner','snack')),
  name         text,
  calories     numeric,
  protein_g    numeric,
  carbs_g      numeric,
  fat_g        numeric,
  logged_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Null when the member logged it; staff email when someone logged it for them.
  created_by   text,
  updated_by   text
);
create index if not exists memberapp_meals_day_idx
  on public.memberapp_meals (member_id, club_number, performed_on desc);
alter table public.memberapp_meals enable row level security;
