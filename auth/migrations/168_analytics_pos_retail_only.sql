-- 168_analytics_pos_retail_only.sql
--
-- POS Sales narrows to GOODS WE STOCK AND SELL, and gains a per-category
-- breakdown and a per-item table.
--
-- RETAIL IS NOW AN EXPLICIT FOUR, NOT AN INFERENCE. Migration 165 defined
-- retail as "any profit centre that has ever carried a unit cost", which was
-- the right guess before anyone had said what retail meant. It is a business
-- definition, not a derivable one: it also swept in Camp Programs, and it would
-- have swept in anything else that happened to get a cost typed against it.
--
--   WCS Drinks        $92,396   69% of lines costed
--   WCS Supplements   $65,910   90%
--   WCS Merchandise   $55,219   46%
--   WCS Snacks        $20,859   73%
--
-- WCS Tanning is excluded deliberately: it shares the prefix, is a service, and
-- has never carried a cost on any of its 136 lines.
--
-- PASS-THROUGH LEAVES THE REPORT ENTIRELY. Dues, personal training, guest fees
-- and club account payments are real money and belong on a revenue report, not
-- on one about product. Keeping them here as a muted column invited exactly the
-- blend that migration 165 existed to prevent, and made the headline eight
-- times the size of the thing being managed.
--
-- PER-ITEM COST AND PRICE ARE QUANTITY-WEIGHTED, so one oddly-priced line
-- cannot move the figure. Cost is averaged only over the units that HAVE a
-- cost, because averaging a null as zero would understate it and inflate the
-- margin — the same trap as 165, one level down.

-- The four. An explicit list because this is a decision, not a pattern.
create or replace function public.analytics_pos_retail_centers()
returns table (profit_center text)
language sql
immutable
as $$
  select * from (values
    ('WCS Drinks'), ('WCS Snacks'), ('WCS Supplements'), ('WCS Merchandise')
  ) as m(profit_center)
$$;

-- ---------------------------------------------------------------------------
-- Month by category, for one line per category on the trend.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pos_by_category(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  month date,
  profit_center text,
  revenue numeric,
  cogs numeric,
  costed_revenue numeric,
  units numeric
)
language sql
stable
as $$
  select
    date_trunc('month', t.transaction_at)::date,
    i.profit_center,
    sum(i.subtotal),
    coalesce(sum(i.quantity * i.unit_cost_at_sale), 0),
    coalesce(sum(i.subtotal) filter (where i.unit_cost_at_sale is not null), 0),
    sum(i.quantity)
  from public.inventory_transactions t
  join public.inventory_transaction_items i on i.transaction_pk = t.id
  join public.analytics_checkin_clubs() c on c.club_number = ltrim(t.club_number, '0')
  join public.analytics_pos_retail_centers() r on r.profit_center = i.profit_center
  where t.transaction_at >= p_start::timestamptz
    and t.transaction_at < (p_end + 1)::timestamptz
    and (p_clubs is null or c.slug = any(p_clubs))
  group by 1, 2
  order by 1, 2
$$;

-- ---------------------------------------------------------------------------
-- Every item sold: cost, price, margin, units.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pos_items(
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
  costed_units numeric,
  unit_cost numeric,
  unit_price numeric,
  margin_pct numeric
)
language sql
stable
as $$
  select
    coalesce(nullif(btrim(i.name), ''), '(unnamed item)'),
    i.profit_center,
    sum(i.quantity),
    sum(i.subtotal),
    coalesce(sum(i.quantity * i.unit_cost_at_sale), 0),
    -- Surfaced so a margin drawn from a third of the units is visible as such.
    coalesce(sum(i.quantity) filter (where i.unit_cost_at_sale is not null), 0),
    -- Averaged ONLY over units that have a cost. Treating a null as zero would
    -- understate cost and inflate margin.
    round(sum(i.quantity * i.unit_cost_at_sale) filter (where i.unit_cost_at_sale is not null)
      / nullif(sum(i.quantity) filter (where i.unit_cost_at_sale is not null), 0), 2),
    round(sum(i.subtotal) / nullif(sum(i.quantity), 0), 2),
    round(100.0 * (coalesce(sum(i.subtotal) filter (where i.unit_cost_at_sale is not null), 0)
                   - coalesce(sum(i.quantity * i.unit_cost_at_sale), 0))
      / nullif(sum(i.subtotal) filter (where i.unit_cost_at_sale is not null), 0), 1)
  from public.inventory_transactions t
  join public.inventory_transaction_items i on i.transaction_pk = t.id
  join public.analytics_checkin_clubs() c on c.club_number = ltrim(t.club_number, '0')
  join public.analytics_pos_retail_centers() r on r.profit_center = i.profit_center
  where t.transaction_at >= p_start::timestamptz
    and t.transaction_at < (p_end + 1)::timestamptz
    and (p_clubs is null or c.slug = any(p_clubs))
  group by 1, 2
  having sum(i.quantity) <> 0
  order by 4 desc
$$;
