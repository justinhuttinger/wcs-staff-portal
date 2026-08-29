-- 170_analytics_revenue.sql
--
-- Analytics > Revenue. Every profit centre, against last month and last year.
--
-- THE DATA GOES BACK TO JANUARY 2024, 32 months and $17.9M, with every club and
-- every day present. It is the only source in this rebuild that needed no
-- caveat about its own completeness.
--
-- PROFIT CENTRES HAVE BEEN RENAMED AND RESPELLED, AND A YEAR-OVER-YEAR REPORT
-- IS EXACTLY WHERE THAT BITES. Comparing this August to last August means
-- reaching back across every rename in between:
--
--   PERSONAL TRAINING   Eugene's label for TRAINING, $186,729, stopped
--                       2024-09. A Training figure for any 2024 month that
--                       ignored it would be short by that much AT EUGENE ONLY,
--                       which reads as a collapse at one club rather than a
--                       relabelling.
--   ANNUAL / ANNUALFEE  the same $37-40 fee under two spellings, both live, at
--                       overlapping clubs.
--   A2EXECDUES /        the same exec dues; the spaced version carries the
--   A2 EXEC DUES        club-collected payments and the unspaced the drafts.
--   LOCKER / LOCKERS    one thing, two spellings.
--
-- So the raw centre is mapped to a stable category before anything is compared.
-- The mapping is spelled out rather than pattern-matched: "anything containing
-- DUES" would sweep in FREEZEFEE-style oddities and quietly change meaning the
-- next time somebody adds a code.
--
-- THE EIGHT HEADLINE CATEGORIES ARE THE ONES THAT GET MANAGED. Everything else
-- still appears, one row per centre, because a revenue report that hides
-- $289,021 of guest fees behind an "Other" bucket is not a revenue report.
--
-- REFUNDS AND CHARGEBACKS ARE THEIR OWN CENTRES AND ARE NEGATIVE. They are not
-- attributable to a category, so they are neither netted into one nor dropped:
-- they show as negative rows and the report says whether a total includes them.

create or replace function public.analytics_revenue_category(p_center text)
returns text
language sql
immutable
as $$
  select case upper(btrim(coalesce(p_center, '')))
    -- Dues, in all its spellings and one-off variants.
    when 'DUES' then 'Dues'
    when 'A2EXECDUES' then 'Dues'
    when 'A2 EXEC DUES' then 'Dues'
    when 'FIRST MONTH DUES' then 'Dues'
    when 'LAST MONTH DUES' then 'Dues'
    when 'PAID IN FULL DUES' then 'Dues'
    when 'SUMMER MEMBERSHIP DUES' then 'Dues'
    when 'CORPORATE DUES' then 'Dues'
    when 'MBODUES' then 'Dues'
    when 'GYMSTRDUES' then 'Dues'

    when 'ANNUALFEE' then 'Annual Fee'
    when 'ANNUAL' then 'Annual Fee'

    -- PERSONAL TRAINING is the rename that matters most here.
    when 'TRAINING' then 'Training'
    when 'PERSONAL TRAINING' then 'Training'

    when 'PRIVATE SWIM LESSONS' then 'Swim'
    when 'GROUP SWIM LESSONS' then 'Swim'
    when 'SWIM CLUB' then 'Swim'
    when 'WCS SWIM ITEMS' then 'Swim'

    when 'WCS DRINKS' then 'Drinks'
    when 'WCS SNACKS' then 'Snacks'
    when 'WCS SUPPLEMENTS' then 'Supplements'
    when 'WCS MERCHANDISE' then 'Merchandise'

    -- Everything else keeps its own identity. Titled here so the report does
    -- not have to shout SCREAMING CASE at the reader.
    else initcap(lower(btrim(coalesce(nullif(p_center, ''), 'Unknown'))))
  end
$$;

-- The eight that get managed, in the order they should be read.
-- Column is sort_order, not position: `position` is a reserved word in
-- Postgres and cannot name a column even in a returns-table clause.
create or replace function public.analytics_revenue_headline()
returns table (category text, sort_order int)
language sql
immutable
as $$
  select * from (values
    ('Dues', 1), ('Annual Fee', 2), ('Training', 3), ('Swim', 4),
    ('Drinks', 5), ('Snacks', 6), ('Supplements', 7), ('Merchandise', 8)
  ) as m(category, sort_order)
$$;

-- ---------------------------------------------------------------------------
-- One window, split by category and by the raw centre inside it.
--
-- Both levels are returned from one pass so the report can show the eight
-- headline categories and still let a reader open one to see which centres it
-- is made of — which is the only way a mapping like the one above can be
-- audited by the person relying on it.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_revenue_by_center(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  category text,
  profit_center text,
  headline_position int,
  revenue numeric,
  txns bigint,
  members bigint
)
language sql
stable
as $$
  select
    public.analytics_revenue_category(r.profit_center),
    coalesce(nullif(btrim(r.profit_center), ''), 'Unknown'),
    h.sort_order,
    sum(r.payment_amount),
    count(*)::bigint,
    count(distinct r.member_number)::bigint
  from public.abc_revenue_transactions r
  left join public.analytics_revenue_headline() h
    on h.category = public.analytics_revenue_category(r.profit_center)
  where r.payment_date >= p_start
    and r.payment_date <= p_end
    and (p_clubs is null or r.location_slug = any(p_clubs))
  group by 1, 2, 3
  order by 3 nulls last, 4 desc
$$;

-- ---------------------------------------------------------------------------
-- Month by category, for the trend.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_revenue_monthly(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  month date,
  category text,
  headline_position int,
  revenue numeric
)
language sql
stable
as $$
  select
    date_trunc('month', r.payment_date)::date,
    public.analytics_revenue_category(r.profit_center),
    h.sort_order,
    sum(r.payment_amount)
  from public.abc_revenue_transactions r
  left join public.analytics_revenue_headline() h
    on h.category = public.analytics_revenue_category(r.profit_center)
  where r.payment_date >= p_start
    and r.payment_date <= p_end
    and (p_clubs is null or r.location_slug = any(p_clubs))
  group by 1, 2, 3
  order by 1, 3 nulls last
$$;

-- ---------------------------------------------------------------------------
-- Club by category, for the per-club view.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_revenue_by_club(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  slug text,
  category text,
  headline_position int,
  revenue numeric
)
language sql
stable
as $$
  select
    r.location_slug,
    public.analytics_revenue_category(r.profit_center),
    h.sort_order,
    sum(r.payment_amount)
  from public.abc_revenue_transactions r
  left join public.analytics_revenue_headline() h
    on h.category = public.analytics_revenue_category(r.profit_center)
  where r.payment_date >= p_start
    and r.payment_date <= p_end
    and (p_clubs is null or r.location_slug = any(p_clubs))
  group by 1, 2, 3
  order by 1, 3 nulls last, 4 desc
$$;
