-- 210_tour_outcome_guest_clackamas.sql
--
-- Guest, offered at Clackamas only: somebody a member brought in, recorded on
-- the tour check-in because that is where the desk is standing.
--
-- Not a tour, so counts_as_tour is false and Tours Given / Tour Conversion
-- leave it out, the same as NLPT and Swim. It grants no pass and is not a sale.
--
-- sort_order 46 sits after Swim (44) and before Custom Pass (50).

insert into public.tour_outcomes
  (outcome, label, is_sale, sort_order, default_pass_days, grants_pass, counts_as_tour, location_slugs)
values
  ('Guest', 'Guest', false, 46, null, false, false, '{clackamas}')
on conflict (outcome) do update
  set label = excluded.label,
      is_sale = excluded.is_sale,
      sort_order = excluded.sort_order,
      default_pass_days = excluded.default_pass_days,
      grants_pass = excluded.grants_pass,
      counts_as_tour = excluded.counts_as_tour,
      location_slugs = excluded.location_slugs;
