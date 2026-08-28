-- Was this person already a member when they were toured?
--
-- A tour given to somebody who already trains here is not a tour in any sense a
-- report cares about, and it inflates every conversion number it lands in. But
-- it is not nothing either: members do come through the kiosk, bringing a guest
-- or being walked round by a new trainer, and staff should not be blocked from
-- recording what actually happened.
--
-- So it is recorded rather than refused, and reporting decides. The whole ABC
-- status is stored rather than a boolean because a CANCELLED member on a tour is
-- a genuine win-back that should still count -- collapsing this to
-- "was_a_member" would throw those in with the active ones.
--
-- Null means the tour resolved to a prospect, or to nobody at all.

alter table public.tour_intakes
  add column if not exists member_status_at_tour text;

comment on column public.tour_intakes.member_status_at_tour is
  'ABC member status at the moment the tour was completed, or null if the person was a prospect or matched nothing. Reports counting new-business tours should exclude ''Active''; a cancelled member being toured is a win-back and counts.';

create index if not exists tour_intakes_member_status_idx
  on public.tour_intakes (member_status_at_tour)
  where member_status_at_tour is not null;
