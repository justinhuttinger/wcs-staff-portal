-- "New class" badge for the public class board.
--
-- ABC has nowhere to store this, so it lives here.
--
-- Keyed on (club_number, event_type_id) rather than a single ABC event: "new"
-- is a property of the class OFFERING, not of one session. Marking StrongHer
-- new at Salem should badge every StrongHer session there, including
-- occurrences created later, without anyone re-ticking a box per class.
-- The same class can be long-running at one club and brand new at another,
-- which is why club_number is part of the key.
--
-- show_until is required, not optional. A badge with no expiry is a badge that
-- stays on a gym TV forever once someone forgets about it.
--
-- This repo has no migration runner. Apply by hand to prod Supabase after merge.

create table if not exists group_x_new_classes (
  club_number    text not null,
  event_type_id  text not null,
  class_name     text not null,
  show_until     date not null,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  primary key (club_number, event_type_id)
);

create index if not exists group_x_new_classes_active_idx
  on group_x_new_classes (club_number, show_until);

-- The portal DB is 100% service-role. Every public table gets RLS enabled with
-- no policy, so a leaked anon key reads nothing.
alter table group_x_new_classes enable row level security;
