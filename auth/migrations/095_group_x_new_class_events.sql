-- Per-session "new class" badges.
--
-- 094 flags a whole class OFFERING as new, which is right when a class type
-- launches. It cannot express the commoner case: Yoga already runs on Friday
-- and we add a Saturday Yoga. Same event type, so a type-level flag would
-- badge the long-running Friday class too.
--
-- This table flags individual ABC events, so only the new day carries the
-- badge. The two work together: a class is new if EITHER its type is flagged
-- or the session itself is.
--
-- Keyed on the ABC event id, so a cancelled class takes its badge with it —
-- there is nothing to clean up.
--
-- This repo has no migration runner. Apply by hand to prod Supabase after merge.

create table if not exists group_x_new_class_events (
  club_number   text not null,
  abc_event_id  text not null,
  class_name    text not null,
  show_until    date not null,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  primary key (club_number, abc_event_id)
);

create index if not exists group_x_new_class_events_active_idx
  on group_x_new_class_events (club_number, show_until);

-- The portal DB is 100% service-role. Every public table gets RLS enabled with
-- no policy, so a leaked anon key reads nothing.
alter table group_x_new_class_events enable row level security;
