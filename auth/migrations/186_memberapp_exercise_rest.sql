-- Rest between sets, prescribed by the coach and counted down in the app.
-- Seconds rather than free text because this one IS a timer: the app has to
-- start a countdown from it, so "60-90s" would be unusable.
alter table public.memberapp_program_exercises
  add column if not exists rest_seconds integer
  check (rest_seconds is null or (rest_seconds >= 0 and rest_seconds <= 3600));

comment on column public.memberapp_program_exercises.rest_seconds is
  'Rest after each set, in seconds. Null means no timer is offered.';
