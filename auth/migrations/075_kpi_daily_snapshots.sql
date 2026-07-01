-- 075_kpi_daily_snapshots.sql
-- Frozen end-of-day KPI history so the KPI report can be scrolled day by day to
-- see exactly when a metric degraded. Each row is one club's one KPI as it stood
-- at end of that Pacific day. `value` is the month-to-date value AS OF that day
-- (stable trend); numerator/denominator/sample_size are the raw inputs so an
-- isolated single-day number can also be derived. `goal` is the goal in effect
-- that day (goals can change later; history keeps what the target was then).
--
-- No backfill: the nightly job starts writing the day it deploys. Past days
-- cannot be reconstructed accurately because the source data has since shifted.

create table if not exists public.kpi_daily_snapshots (
  snapshot_date  date        not null,
  location_slug  text        not null,
  kpi_key        text        not null,
  value          numeric,               -- headline value (MTD-as-of-day); null = n/a
  goal           numeric,               -- goal in effect that day; null = no goal set
  numerator      numeric,               -- raw inputs (null when not a ratio metric)
  denominator    numeric,
  sample_size    integer,               -- e.g. contacts for speed-to-lead
  computed_at    timestamptz not null default now(),
  primary key (snapshot_date, location_slug, kpi_key)
);

-- Range scans by club over a date window (the History view's main query).
create index if not exists kpi_daily_snapshots_loc_date_idx
  on public.kpi_daily_snapshots (location_slug, snapshot_date);

-- Portal DB access is 100% service-role; enable RLS with no policy so the table
-- is locked to everything except the service key (matches the app-wide pattern).
alter table public.kpi_daily_snapshots enable row level security;
