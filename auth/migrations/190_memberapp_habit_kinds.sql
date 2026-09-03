-- Three more habit kinds: an evening screens cutoff, journalling, and food
-- logging. The kind drives the icon and the level presets, so a new one has to
-- be spelled out here before either app can offer it.
--
-- Depends on 189.

alter table public.memberapp_habits
  drop constraint if exists memberapp_habits_kind_check;

alter table public.memberapp_habits
  add constraint memberapp_habits_kind_check
  check (kind in ('water','sleep','steps','detox','journal','food','custom'));
