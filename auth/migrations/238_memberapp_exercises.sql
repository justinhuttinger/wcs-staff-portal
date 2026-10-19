-- Coaching: the exercise library.
--
-- One row per exercise, whatever supplies its demo. Programs and workout logs
-- (Coaching PR 2+) reference this table's id, never a vendor id, so the video
-- source can change per exercise (free images today, YMove video once the key
-- lands, WCS-filmed clips later) without touching a single program.
--
--   source = 'free'   free-exercise-db (Unlicense), still images only
--            'ymove'  YMove Exercise API; signed video URLs are fetched at play
--                     time and never stored here (they expire after 48h)
--            'custom' added by a WCS trainer
--
-- When YMove is synced, a YMove exercise whose normalised name matches a
-- 'free' row is linked onto that row (same id, source flips to 'ymove'), which
-- is why name_key is stored and indexed.

create table if not exists public.memberapp_exercises (
  id                uuid primary key default gen_random_uuid(),
  source            text not null check (source in ('free','ymove','custom')),
  -- The supplier's own id: free-exercise-db slug, YMove uuid. Null for custom.
  source_id         text,
  slug              text,
  name              text not null,
  -- Normalised name used to match vendors onto each other (see
  -- auth/src/lib/exerciseLibrary.js nameKey).
  name_key          text not null,
  primary_muscle    text,
  secondary_muscles text[] not null default '{}',
  equipment         text,
  category          text,
  difficulty        text,
  instructions      text[] not null default '{}',
  cues              text[] not null default '{}',
  -- Static and cacheable for every source.
  thumbnail_url     text,
  has_video         boolean not null default false,
  -- Only for videos WCS owns (custom rows). YMove video URLs are never stored.
  video_url         text,
  is_active         boolean not null default true,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists memberapp_exercises_source_uidx
  on public.memberapp_exercises (source, source_id) where source_id is not null;
create index if not exists memberapp_exercises_name_key_idx
  on public.memberapp_exercises (name_key);
create index if not exists memberapp_exercises_muscle_idx
  on public.memberapp_exercises (primary_muscle) where is_active;
-- No trigram index: the library is a couple of thousand rows, and a plain
-- ilike scan of that is instant.

alter table public.memberapp_exercises enable row level security;
