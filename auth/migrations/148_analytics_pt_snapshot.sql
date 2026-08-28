-- 148_analytics_pt_snapshot.sql
--
-- Analytics > PT Snapshot: one whole-club view of training, month to date.
--
-- The definitions here are lifted from PT Health (auth/src/routes/ptHealth.js)
-- so the two reports agree, with ONE deliberate and documented exception.
--
--   New client vs resign   a sale is a RESIGN if that member has another PT
--                          sale in the 90 days before it; otherwise a new
--                          client. Same 90-day lookback PT Health uses, which
--                          is why the scan starts 90 days before p_start.
--   RS vs PIF              recurring_type_desc containing 'paid in full'.
--   Sale value             invoice_total.
--
-- THE EXCEPTION — BURNED PIF IS NOT COUNTED AS A LOSS HERE.
-- PT Health calls ABC per member to ask whether a paid-in-full package has any
-- sessions left, and counts the package as burned when it does not. That answer
-- does not exist in Supabase: no PIF row in abc_pt_services has ever been given
-- an inactive_date (verified across every month back to March 2026 — zero, not
-- a few). So the loss side of this report is RECURRING SERVICE DEACTIVATIONS
-- ONLY, and the report says so on its face rather than showing a total that
-- quietly runs lower than PT Health's.

-- ---------------------------------------------------------------------------
-- Club identity. PT services carry an ABC club number; Day Ones carry a slug.
-- Callers pass club numbers, as every other analytics_* function takes them.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_club_slugs(p_clubs text[])
returns text[]
language sql
immutable
as $$
  select case when p_clubs is null then null else array(
    select m.slug from (values
      ('30935','salem'), ('31599','keizer'),  ('7655','eugene'),
      ('31598','springfield'), ('31600','clackamas'),
      ('31601','milwaukie'), ('32073','medford')
    ) as m(num, slug)
    -- Tolerate the zero padding some ABC feeds put on Eugene.
    where m.num = any(select ltrim(c, '0') from unnest(p_clubs) c)
  ) end
$$;

-- ---------------------------------------------------------------------------
-- Why a Day One did not close.
--
-- The structured picker is barely used: 490 of 526 no-sale Day Ones this year
-- chose "Other" and typed the real reason free-hand. Reporting the picker alone
-- would say "93% Other", which tells nobody anything. So "Other" is resolved
-- against the text the trainer actually wrote.
--
-- The buckets below come from reading the free text, not from guessing: money
-- alone appears as poor, broke, money, finances, no job, fixed income and
-- student. Order matters — the most specific test wins, because "going to
-- college, poor" is an affordability answer, not a schooling one.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pt_no_sale_bucket(p_reason text, p_other text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(btrim(p_reason), '') = '' then 'Not Recorded'
    when p_reason <> 'Other' then p_reason
    else (
      select case
        when t ~ 'minor|parent|yr old|year old|jr\.? ?cert|too young' then 'Too young or needs a parent'
        when t ~ 'has a (trainer|program)|already (has|established)|own (trainer|program)|coaching|physical therap' then 'Already has a trainer or a program'
        when t ~ 'orientation|inbody|in body|scan|machine|just wanted|only wanted|promo|free session|tour' then 'Only wanted the free session or InBody scan'
        when t ~ 'poor|broke|money|afford|financ|cost|price|expensive|no job|fixed income|budget|student|college' then 'Cannot afford it right now'
        when t ~ 'wife|husband|spouse|partner|think|consider|fence|decide|reconnect|next time|later' then 'Thinking it over or asking a spouse'
        when t ~ 'schedul|travel|vacation|moved|moving|new job|busy|time|work' then 'Timing or schedule'
        when t ~ 'not interested|no interest|not needed|does not (want|desire)|doesn''t (want|desire)' then 'Not interested in training'
        when coalesce(btrim(t), '') = '' then 'Other (nothing written)'
        else 'Other (unclassified)'
      end
      from (select lower(coalesce(p_other, ''))) as x(t)
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- Every PT sale in a window, already labelled new-vs-resign and RS-vs-PIF.
-- Shared by the totals, the breakdowns and the monthly series so the three can
-- never drift apart.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pt_sales_labelled(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  club_number text,
  member_id text,
  sale_date date,
  value numeric,
  is_pif boolean,
  is_resign boolean
)
language sql
stable
as $$
  with scanned as (
    -- Reaches 90 days behind p_start: a sale is only judged a resign against
    -- what came before it, so the lookback has to be loaded to judge it.
    select
      s.club_number,
      s.member_id,
      s.sale_date::date as sale_date,
      coalesce(s.invoice_total, 0)::numeric as value,
      (s.recurring_type_desc ilike '%paid in full%') as is_pif
    from public.abc_pt_services s
    where s.sale_date is not null
      and s.sale_date::date >= (p_start - 90)
      and s.sale_date::date <= p_end
      and (p_clubs is null or ltrim(s.club_number, '0') = any(select ltrim(c, '0') from unnest(p_clubs) c))
  )
  select
    a.club_number,
    a.member_id,
    a.sale_date,
    a.value,
    a.is_pif,
    exists (
      select 1 from scanned b
      where b.member_id = a.member_id
        and b.sale_date < a.sale_date
        and b.sale_date >= a.sale_date - 90
    ) as is_resign
  from scanned a
  where a.sale_date >= p_start
    and a.sale_date <= p_end
$$;

-- ---------------------------------------------------------------------------
-- Recurring services deactivated in a window. The loss side, RS only —
-- see the note at the top of this file.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pt_losses(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  club_number text,
  member_id text,
  inactive_date date,
  value numeric,
  reason text
)
language sql
stable
as $$
  select
    s.club_number,
    s.member_id,
    s.inactive_date::date,
    coalesce(s.invoice_total, 0)::numeric,
    coalesce(nullif(btrim(s.deactivate_reason), ''), 'Not Recorded')
  from public.abc_pt_services s
  where s.inactive_date is not null
    and s.inactive_date::date between p_start and p_end
    and s.recurring_type_desc not ilike '%paid in full%'
    and (p_clubs is null or ltrim(s.club_number, '0') = any(select ltrim(c, '0') from unnest(p_clubs) c))
$$;

-- ---------------------------------------------------------------------------
-- The headline row.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pt_snapshot(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  day_ones bigint,
  day_ones_completed bigint,
  day_ones_no_show bigint,
  day_ones_cancelled bigint,
  day_ones_scheduled bigint,
  day_ones_sold bigint,
  day_ones_no_sale bigint,
  new_sales bigint,
  new_clients bigint,
  resigns bigint,
  new_rs_count bigint,
  new_pif_count bigint,
  new_value numeric,
  new_rs_value numeric,
  new_pif_value numeric,
  new_client_value numeric,
  resign_value numeric,
  lost_count bigint,
  lost_value numeric
)
language sql
stable
as $$
  with slugs as (select public.analytics_club_slugs(p_clubs) as s),
  d as (
    select d.status, d.outcome
    from public.day_one_appointments d, slugs
    -- The appointment DATE, not when it was booked. PT Health filters the same
    -- way; the two fields produce different cohorts.
    where d.scheduled_date::date between p_start and p_end
      and (slugs.s is null or d.location_slug = any(slugs.s))
  ),
  sales as (select * from public.analytics_pt_sales_labelled(p_start, p_end, p_clubs)),
  loss as (select * from public.analytics_pt_losses(p_start, p_end, p_clubs))
  select
    (select count(*) from d),
    (select count(*) from d where status = 'completed'),
    (select count(*) from d where status = 'no_show'),
    (select count(*) from d where status = 'cancelled'),
    (select count(*) from d where status = 'scheduled'),
    (select count(*) from d where outcome = 'Sale'),
    (select count(*) from d where outcome = 'No Sale'),
    (select count(*) from sales),
    (select count(*) from sales where not is_resign),
    (select count(*) from sales where is_resign),
    (select count(*) from sales where not is_pif),
    (select count(*) from sales where is_pif),
    (select coalesce(sum(value), 0) from sales),
    (select coalesce(sum(value) filter (where not is_pif), 0) from sales),
    (select coalesce(sum(value) filter (where is_pif), 0) from sales),
    (select coalesce(sum(value) filter (where not is_resign), 0) from sales),
    (select coalesce(sum(value) filter (where is_resign), 0) from sales),
    (select count(*) from loss),
    (select coalesce(sum(value), 0) from loss)
$$;

-- ---------------------------------------------------------------------------
-- The breakdowns, one long table so the route makes a single call.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pt_snapshot_breakdown(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  kind text,
  label text,
  cnt bigint,
  value numeric
)
language sql
stable
as $$
  with slugs as (select public.analytics_club_slugs(p_clubs) as s),
  d as (
    select d.*
    from public.day_one_appointments d, slugs
    where d.scheduled_date::date between p_start and p_end
      and (slugs.s is null or d.location_slug = any(slugs.s))
  ),
  sales as (select * from public.analytics_pt_sales_labelled(p_start, p_end, p_clubs)),
  loss as (select * from public.analytics_pt_losses(p_start, p_end, p_clubs))

  -- Why the ones that did not close, did not close.
  select 'no_sale_reason',
         public.analytics_pt_no_sale_bucket(why_no_sale, why_no_sale_other),
         count(*), 0::numeric
  from d where outcome = 'No Sale'
  group by 2

  union all
  -- What the ones that did close, bought.
  select 'sold_type', coalesce(nullif(btrim(pt_sale_type), ''), 'Not Recorded'),
         count(*), 0::numeric
  from d where outcome = 'Sale'
  group by 2

  union all
  -- New business by type, in clients and in money.
  select 'new_type', case when is_pif then 'Paid in Full' else 'Recurring' end,
         count(*), coalesce(sum(value), 0)
  from sales group by 2

  union all
  -- New business by whether the client is new or coming back.
  select 'new_client_type', case when is_resign then 'Resign' else 'New Client' end,
         count(*), coalesce(sum(value), 0)
  from sales group by 2

  union all
  -- Losses by the reason ABC was given.
  select 'lost_reason', reason, count(*), coalesce(sum(value), 0)
  from loss group by 2
$$;

-- ---------------------------------------------------------------------------
-- Month-by-month, for the trend panels. Month to date on the newest month, so
-- the current month is compared like for like rather than against full months.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_pt_monthly(
  p_end date,
  p_months integer default 13,
  p_clubs text[] default null
)
returns table (
  month_start date,
  day_ones bigint,
  day_ones_completed bigint,
  day_ones_sold bigint,
  new_sales bigint,
  new_clients bigint,
  new_value numeric,
  new_rs_value numeric,
  new_pif_value numeric,
  lost_count bigint,
  lost_value numeric
)
language sql
stable
as $$
  with months as (
    select generate_series(
      date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    )::date as m
  ),
  bounds as (
    -- The newest month stops at p_end; every earlier one runs to its own end.
    select m as start_d,
           least((m + interval '1 month' - interval '1 day')::date, p_end) as end_d
    from months
  )
  select
    b.start_d,
    coalesce(t.day_ones, 0),
    coalesce(t.day_ones_completed, 0),
    coalesce(t.day_ones_sold, 0),
    coalesce(t.new_sales, 0),
    coalesce(t.new_clients, 0),
    coalesce(t.new_value, 0),
    coalesce(t.new_rs_value, 0),
    coalesce(t.new_pif_value, 0),
    coalesce(t.lost_count, 0),
    coalesce(t.lost_value, 0)
  from bounds b
  left join lateral public.analytics_pt_snapshot(b.start_d, b.end_d, p_clubs) t on true
  order by b.start_d
$$;
