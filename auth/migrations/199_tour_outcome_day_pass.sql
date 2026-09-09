-- 199_tour_outcome_day_pass.sql
--
-- A day pass: somebody tours, trains today, and goes home. It was being
-- recorded as Custom Pass with a 1 typed in, or as Only Tour, which loses the
-- fact that access was handed out at all.
--
-- One day, so default_pass_days is 1 rather than null. Null means "ask the
-- staff member how long", which is what Custom Pass is for; a day pass has its
-- length in its name and nobody should be typing it.
--
-- grants_pass because it does: the kiosk writes the expiration and visit
-- allowance to ABC and posts the desk alert, exactly as a trial does. Without
-- the flag they would be told they have a pass and then bounce off the door.
--
-- sort_order 35 puts it between the VIP pass and Only Tour, so the list stays
-- ordered longest-access to none.

insert into public.tour_outcomes (outcome, label, is_sale, sort_order, default_pass_days, grants_pass) values
  ('Day Pass', 'Day Pass', false, 35, 1, true)
on conflict (outcome) do update
  set label = excluded.label,
      is_sale = excluded.is_sale,
      sort_order = excluded.sort_order,
      default_pass_days = excluded.default_pass_days,
      grants_pass = excluded.grants_pass;
