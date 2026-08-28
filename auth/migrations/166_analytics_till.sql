-- 166_analytics_till.sql
--
-- Analytics > Till.
--
-- ONE SQL PASS FOR WHAT THE REPORT ROUTE DOES IN MANY ROUND TRIPS.
-- auth/src/lib/tillCashMovements.js fetches cash payments per club, then
-- batches a second query for line UPCs 200 transactions at a time, then joins
-- in JS — because inventory_transaction_payments has no FK PostgREST can embed
-- to inventory_transaction_items (the link is the composite
-- (transaction_pk, line_no)). That is fine for one club and one day. Across
-- seven clubs and a reporting window it is dozens of round trips, so the join
-- happens here instead.
--
-- THE CLASSIFICATION RULES ARE COPIED EXACTLY FROM classifyCashLine(), because
-- the two must never disagree about what a drawer did:
--
--   cash tenders only
--   physical register only    employee_id present AND station_name is not
--                             'ABC Transaction'
--   drop    line UPC equals the club's configured drop sentinel — cash pulled
--           from the drawer, not a sale
--   refund  is_return. ABC stores refund cash as a NEGATIVE payment_amount, so
--           the magnitude is taken and reconcileDay subtracts it
--   sale    everything else
--
-- BUCKETED BY PACIFIC BUSINESS DAY, not UTC. A drawer closes on the club's
-- calendar, and an 8pm close is already tomorrow in UTC — the same trap that
-- dated Problem Areas jobs a day into the future in #740.
--
-- The over/short arithmetic itself is NOT duplicated here. It stays in
-- auth/src/lib/tillReconcile.js, which the route calls, so there is exactly one
-- definition of expected close and one of over/short.

create or replace function public.analytics_till_cash_by_day(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  slug text,
  club_number text,
  business_date date,
  cash_sales numeric,
  cash_refunds numeric,
  cash_drops numeric
)
language sql
stable
as $$
  select
    c.slug,
    t.club_number,
    (t.transaction_at at time zone 'America/Los_Angeles')::date as business_date,
    coalesce(sum(p.payment_amount) filter (
      where (s.drop_upc is null or i.upc is distinct from s.drop_upc) and not t.is_return
    ), 0),
    -- Magnitude, not the negative ABC stores, so reconcileDay can subtract it.
    coalesce(sum(abs(p.payment_amount)) filter (
      where (s.drop_upc is null or i.upc is distinct from s.drop_upc) and t.is_return
    ), 0),
    coalesce(sum(p.payment_amount) filter (
      where s.drop_upc is not null and i.upc = s.drop_upc
    ), 0)
  from public.inventory_transaction_payments p
  join public.inventory_transactions t on t.id = p.transaction_pk
  -- The composite line link PostgREST cannot embed.
  left join public.inventory_transaction_items i
    on i.transaction_pk = p.transaction_pk and i.line_no = p.line_no
  join public.analytics_checkin_clubs() c on c.club_number = ltrim(t.club_number, '0')
  left join public.till_settings s on ltrim(s.club_number, '0') = ltrim(t.club_number, '0')
  where p.tender_category = 'cash'
    -- Physical register only. ABC-side transactions never touched the drawer.
    and t.employee_id is not null
    and t.station_name is distinct from 'ABC Transaction'
    and (t.transaction_at at time zone 'America/Los_Angeles')::date >= p_start
    and (t.transaction_at at time zone 'America/Los_Angeles')::date <= p_end
    and (p_clubs is null or c.slug = any(p_clubs))
  group by 1, 2, 3
  order by 3, 1
$$;

-- ---------------------------------------------------------------------------
-- The counts themselves, so the route does not page them by hand.
--
-- Returned per club/date/type rather than pivoted: a day can be missing its
-- open, its close, or both, and the report reports on exactly that.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_till_counts(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  slug text,
  club_number text,
  business_date date,
  count_type text,
  counted_amount numeric,
  employee_name text
)
language sql
stable
as $$
  select
    coalesce(tc.location_slug, c.slug),
    tc.club_number,
    tc.business_date,
    tc.count_type,
    tc.counted_amount,
    nullif(btrim(tc.employee_name), '')
  from public.till_counts tc
  left join public.analytics_checkin_clubs() c on c.club_number = ltrim(tc.club_number, '0')
  where tc.business_date >= p_start
    and tc.business_date <= p_end
    and (p_clubs is null or coalesce(tc.location_slug, c.slug) = any(p_clubs))
  order by tc.business_date, 1, tc.count_type
$$;
