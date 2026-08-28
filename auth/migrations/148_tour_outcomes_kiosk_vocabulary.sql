-- Tour outcomes become the five the front desk actually uses, and a completed
-- tour records how long a pass it handed out.
--
-- 147 seeded a sales vocabulary (joined / no_sale / thinking / not_a_fit /
-- no_show / rescheduled). The tour check-in has never used those. Its five
-- outcomes answer a different question -- what the person LEFT WITH -- and
-- three of them do real work: Started Trial, Started VIP Pass and Custom Pass
-- each carry a day count that writes an expiration date and a visit allowance
-- into ABC and puts an alert on the front desk. A sales disposition carries no
-- day count, so adopting one would have meant rebuilding pass granting as a
-- separate control for no gain.
--
-- Nothing is lost by replacing them: no tour has ever been recorded with a 147
-- outcome, because completed tours were deleted rather than kept (fixed in the
-- same change as this migration).

alter table public.tour_outcomes
  add column if not exists default_pass_days integer,
  add column if not exists grants_pass boolean not null default false;

comment on column public.tour_outcomes.default_pass_days is
  'Days of access this outcome grants, where the length is fixed. Null on an outcome that grants none, and also null on Custom Pass, whose length is chosen per tour.';

-- Needed as well as default_pass_days, because null means two different things:
-- Only Tour grants nothing, Custom Pass grants whatever staff chose. Without
-- this flag those two are indistinguishable and the validation cannot tell a
-- missing length from a length that was never wanted.
comment on column public.tour_outcomes.grants_pass is
  'True when this outcome hands out gym access, whether the length is fixed or chosen per tour.';

delete from public.tour_outcomes
 where outcome in ('joined', 'no_sale', 'thinking', 'not_a_fit', 'no_show', 'rescheduled');

-- The keys ARE the labels. The check-in has sent these exact strings since it
-- was built, and inventing snake_case keys would only add a translation layer
-- between the app and the table for the two of them to disagree across.
insert into public.tour_outcomes (outcome, label, is_sale, sort_order, default_pass_days, grants_pass) values
  ('Membership Sale',  'Membership Sale',  true,  10, null, false),
  ('Started Trial',    'Started Trial',    false, 20, 7,    true),
  ('Started VIP Pass', 'Started VIP Pass', false, 30, 14,   true),
  ('Only Tour',        'Only Tour',        false, 40, null, false),
  ('Custom Pass',      'Custom Pass',      false, 50, null, true)
on conflict (outcome) do update
  set label = excluded.label,
      is_sale = excluded.is_sale,
      sort_order = excluded.sort_order,
      default_pass_days = excluded.default_pass_days,
      grants_pass = excluded.grants_pass;

-- How long a pass the tour actually handed out. Fixed for Trial and VIP, chosen
-- per tour for Custom Pass, so it cannot be derived from the outcome alone --
-- a 30-day Custom Pass and a 3-day one are the same outcome and very different
-- things to have given away.
alter table public.tour_intakes
  add column if not exists pass_days integer;

comment on column public.tour_intakes.pass_days is
  'Days of access granted by this tour, or null where the outcome granted none. For Custom Pass this is the only record of the length.';
