-- 165_analytics_pos_sales.sql
--
-- Analytics > POS Sales.
--
-- MOST OF WHAT CROSSES THE TILL IS NOT A SALE OF GOODS, and mixing the two
-- makes every margin figure meaningless. August 2026:
--
--   TRAINING (service)      $156,744    0% costed
--   CLUB ACCOUNT PAYMENT    $109,685    0%
--   DUES                     $32,051    0%
--   WCS Drinks               $24,994   71% costed
--   WCS Supplements          $15,587   93%
--   WCS Merchandise          $12,789   84%
--
-- Only 10.9% of POS revenue carries a unit cost. Treating the missing costs as
-- zero — the obvious implementation — reports a 92.7% gross margin. The true
-- margin on goods actually sold is 33.5%. A 59 point error, and it would have
-- looked entirely plausible on a dashboard.
--
-- The missing costs are NOT a data gap. Dues, training, club account payments
-- and guest fees have no cost of goods because no goods were sold. So this
-- report splits POS into two streams and never blends them:
--
--   RETAIL        goods. Revenue, COGS, margin, units, top products.
--   PASS-THROUGH  dues, PT, fees and account payments collected at the desk.
--                 Revenue only. A margin is never computed on it.
--
-- RETAIL IS IDENTIFIED FROM THE DATA, NOT A HARDCODED LIST. A profit centre
-- counts as retail if it has ever carried a unit cost. That splits cleanly
-- today — every WCS catalogue and Camp Programs are costed, every fee and dues
-- line is not — and it keeps working when a new product line appears, which a
-- list in code would not. A retail centre whose costs were never entered would
-- be misclassified, so the report also states cost coverage and lets that be
-- seen rather than assumed.
--
-- RETURNS ALREADY CARRY NEGATIVE SUBTOTALS, so sums are correct without
-- special handling. They are surfaced separately anyway: $50,603 returned
-- against $480,197 gross in August is 10.5% and belongs on the report rather
-- than silently netted away.
--
-- AND THEY ARE SPLIT BY STREAM, because a single returns figure is actively
-- misleading here. Clackamas returned $19,315 in August against retail revenue
-- of $8,249 — the returns are overwhelmingly reversed dues and account
-- payments, not product coming back. Printed next to retail they would read as
-- a catastrophic return rate on goods.
--
-- History starts MAY 2026. There is no earlier POS data, so the trend is short
-- by nature rather than by filtering.

-- ---------------------------------------------------------------------------
-- Which profit centres are goods.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pos_retail_centers()
returns table (profit_center text)
language sql
stable
as $$
  select distinct coalesce(i.profit_center, '(none)')
  from public.inventory_transaction_items i
  where i.unit_cost_at_sale is not null
$$;

-- ---------------------------------------------------------------------------
-- Month by club, both streams side by side.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pos_monthly(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  month date,
  slug text,
  transactions bigint,
  retail_revenue numeric,
  retail_cogs numeric,
  retail_units numeric,
  retail_costed_revenue numeric,
  passthrough_revenue numeric,
  retail_returns numeric,
  passthrough_returns numeric
)
language sql
stable
as $$
  with retail as (select profit_center from public.analytics_pos_retail_centers())
  select
    date_trunc('month', t.transaction_at)::date,
    c.slug,
    count(distinct t.id)::bigint,
    coalesce(sum(i.subtotal) filter (where r.profit_center is not null), 0),
    coalesce(sum(i.quantity * i.unit_cost_at_sale) filter (where r.profit_center is not null), 0),
    coalesce(sum(i.quantity) filter (where r.profit_center is not null), 0),
    -- The slice of retail revenue that actually has a cost behind it. Margin is
    -- computed over THIS, never over all retail revenue.
    coalesce(sum(i.subtotal) filter (where r.profit_center is not null and i.unit_cost_at_sale is not null), 0),
    coalesce(sum(i.subtotal) filter (where r.profit_center is null), 0),
    coalesce(sum(i.subtotal) filter (where t.is_return and r.profit_center is not null), 0),
    coalesce(sum(i.subtotal) filter (where t.is_return and r.profit_center is null), 0)
  from public.inventory_transactions t
  join public.inventory_transaction_items i on i.transaction_pk = t.id
  join public.analytics_checkin_clubs() c on c.club_number = ltrim(t.club_number, '0')
  left join retail r on r.profit_center = coalesce(i.profit_center, '(none)')
  where t.transaction_at >= p_start::timestamptz
    and t.transaction_at < (p_end + 1)::timestamptz
    and (p_clubs is null or c.slug = any(p_clubs))
  group by 1, 2
  order by 1, 2
$$;

-- ---------------------------------------------------------------------------
-- What actually sold. Retail only — a "top product" list containing DUES is
-- not a product list.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pos_products(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  name text,
  profit_center text,
  units numeric,
  revenue numeric,
  cogs numeric,
  costed_revenue numeric,
  margin_pct numeric
)
language sql
stable
as $$
  with retail as (select profit_center from public.analytics_pos_retail_centers())
  select
    coalesce(nullif(btrim(i.name), ''), '(unnamed item)'),
    coalesce(i.profit_center, '(none)'),
    sum(i.quantity),
    sum(i.subtotal),
    coalesce(sum(i.quantity * i.unit_cost_at_sale), 0),
    coalesce(sum(i.subtotal) filter (where i.unit_cost_at_sale is not null), 0),
    round(
      100.0 * (coalesce(sum(i.subtotal) filter (where i.unit_cost_at_sale is not null), 0)
               - coalesce(sum(i.quantity * i.unit_cost_at_sale), 0))
      / nullif(sum(i.subtotal) filter (where i.unit_cost_at_sale is not null), 0), 1)
  from public.inventory_transactions t
  join public.inventory_transaction_items i on i.transaction_pk = t.id
  join public.analytics_checkin_clubs() c on c.club_number = ltrim(t.club_number, '0')
  join retail r on r.profit_center = coalesce(i.profit_center, '(none)')
  where t.transaction_at >= p_start::timestamptz
    and t.transaction_at < (p_end + 1)::timestamptz
    and (p_clubs is null or c.slug = any(p_clubs))
  group by 1, 2
  having sum(i.subtotal) <> 0
  order by 4 desc
$$;

-- ---------------------------------------------------------------------------
-- Profit centre breakdown, both streams, so the split itself is visible.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pos_centers(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  profit_center text,
  is_retail boolean,
  lines bigint,
  revenue numeric,
  cogs numeric,
  costed_revenue numeric,
  pct_costed numeric
)
language sql
stable
as $$
  with retail as (select profit_center from public.analytics_pos_retail_centers())
  select
    coalesce(i.profit_center, '(none)'),
    (r.profit_center is not null),
    count(*)::bigint,
    sum(i.subtotal),
    coalesce(sum(i.quantity * i.unit_cost_at_sale), 0),
    coalesce(sum(i.subtotal) filter (where i.unit_cost_at_sale is not null), 0),
    round(100.0 * count(*) filter (where i.unit_cost_at_sale is not null) / nullif(count(*), 0), 1)
  from public.inventory_transactions t
  join public.inventory_transaction_items i on i.transaction_pk = t.id
  join public.analytics_checkin_clubs() c on c.club_number = ltrim(t.club_number, '0')
  left join retail r on r.profit_center = coalesce(i.profit_center, '(none)')
  where t.transaction_at >= p_start::timestamptz
    and t.transaction_at < (p_end + 1)::timestamptz
    and (p_clubs is null or c.slug = any(p_clubs))
  group by 1, 2
  order by 4 desc
$$;
