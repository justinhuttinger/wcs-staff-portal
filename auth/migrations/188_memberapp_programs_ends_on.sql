-- Ending a program is not deleting it: the member's logged workouts point at
-- it, and a coach wants the history. ends_on retires it on a date while
-- leaving everything intact.
alter table public.memberapp_programs
  add column if not exists ends_on date;

comment on column public.memberapp_programs.ends_on is
  'Last day this program is in effect. Null means it runs until something replaces it. A past date means it has finished and the member no longer sees it.';

-- Guard the obvious mistake rather than discovering it as a program that never
-- appears.
alter table public.memberapp_programs
  drop constraint if exists memberapp_programs_date_range;
alter table public.memberapp_programs
  add constraint memberapp_programs_date_range
  check (ends_on is null or starts_on is null or ends_on >= starts_on);
