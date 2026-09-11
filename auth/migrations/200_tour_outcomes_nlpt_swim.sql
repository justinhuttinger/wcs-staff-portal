-- 200_tour_outcomes_nlpt_swim.sql
--
-- Two new outcomes, NLPT and Swim, offered at Milwaukie and Clackamas only, and
-- a way to say an outcome is not a tour.
--
-- counts_as_tour: NLPT, Swim and Day Pass are recorded on the tour check-in
-- because that is where the desk is standing, but none of them is somebody
-- being shown round the gym. Tours Given, Tour Conversion and the Tours drill
-- leave them out. The tour_intakes row is still written and the webhook still
-- fires, so nothing downstream of the check-in changes.
--
-- location_slugs: the clubs that offer the outcome, by lowercase club name
-- (the same slug the kiosk URL carries). Null means every club, which is what
-- every existing row gets.
--
-- Neither new outcome grants a pass or counts as a sale.

alter table public.tour_outcomes
  add column if not exists counts_as_tour boolean not null default true,
  add column if not exists location_slugs text[];

comment on column public.tour_outcomes.counts_as_tour is
  'False when picking this outcome means the visit was not a tour (Day Pass, NLPT, Swim). The row is kept; the tour reports skip it.';

comment on column public.tour_outcomes.location_slugs is
  'Lowercase club names that offer this outcome. Null means every club.';

update public.tour_outcomes set counts_as_tour = false where outcome = 'Day Pass';

-- sort_order 42 and 44 sit between Only Tour (40) and Custom Pass (50).
insert into public.tour_outcomes
  (outcome, label, is_sale, sort_order, default_pass_days, grants_pass, counts_as_tour, location_slugs)
values
  ('NLPT', 'NLPT', false, 42, null, false, false, '{milwaukie,clackamas}'),
  ('Swim', 'Swim', false, 44, null, false, false, '{milwaukie,clackamas}')
on conflict (outcome) do update
  set label = excluded.label,
      is_sale = excluded.is_sale,
      sort_order = excluded.sort_order,
      default_pass_days = excluded.default_pass_days,
      grants_pass = excluded.grants_pass,
      counts_as_tour = excluded.counts_as_tour,
      location_slugs = excluded.location_slugs;
