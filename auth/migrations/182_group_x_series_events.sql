-- Which ABC classes a Group X series created.
--
-- Migration 093 deliberately kept no local mirror of the ABC schedule, and
-- that still holds: this table is a LINK, not a copy. It stores no time, no
-- instructor and no class name -- ABC remains the source of truth for all of
-- that. It answers one question the ABC API cannot: which series produced this
-- class.
--
-- Without it, "change every class from here on" has nothing to act on, because
-- POST /series already throws away the event ids it gets back.
--
-- event_date is denormalised from the ABC timestamp purely so the edit path can
-- select "occurrences on or after this date" without calling ABC first.
--
-- This repo has no migration runner. Apply by hand to prod Supabase after merge.

create table if not exists group_x_series_events (
  club_number   text not null,
  abc_event_id  text not null,
  series_id     uuid not null references group_x_series(id) on delete cascade,
  event_date    date not null,
  created_at    timestamptz not null default now(),
  primary key (club_number, abc_event_id)
);

-- The edit path's main read: this series, from this date onward.
create index if not exists group_x_series_events_series_idx
  on group_x_series_events (series_id, event_date);

-- The portal DB is 100% service-role. Every public table gets RLS enabled with
-- no policy, so a leaked anon key reads nothing.
alter table group_x_series_events enable row level security;
