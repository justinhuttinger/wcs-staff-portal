-- 174_analytics_payroll.sql
--
-- Analytics > Payroll. Commission per person per period, from the two sources
-- that pay it.
--
--   payroll_sales_commissions      uploaded monthly from the POS export.
--   payroll_recurring_commissions  pulled from ABC recurring services.
--
-- THE TWO TABLES DO NOT JOIN ON NAME AS WRITTEN. Zero of 31 people matched,
-- even case-insensitively, because the sales upload writes a DOUBLE SPACE:
--
--   sales      'Katie  Castlio'
--   recurring  'Katie Castlio'
--
-- Collapsing whitespace takes that from 0 matches to 25. Anyone building on
-- these tables will hit the same wall, so the normalisation lives in a function
-- both sides call rather than being inlined and rediscovered.
--
-- A FULL OUTER JOIN, NOT AN INNER ONE. A trainer with recurring commission and
-- no sales is normal, not an error, and an inner join would silently drop the
-- people whose whole pay is PT. Six of the 31 are in exactly that position.
--
-- MATCHED ON NAME *AND CLUB*. Ryan Harris earns at Medford and at Eugene in the
-- same month; pooling him would hide which club owes what, and the sales export
-- is per club.
--
-- ONE COMMISSION ROW NAMES TWO PEOPLE: 'Victoria Mattox, Devyn Trebesch', a
-- split that cannot be attributed to either. It is flagged rather than guessed
-- at or dropped — the money is real, the attribution is not.

/**
 * The join key. Lowercased with runs of whitespace collapsed.
 */
create or replace function public.analytics_payroll_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')), '')
$$;

/**
 * Every period either source has, newest first, and which sources it holds.
 *
 * The sales half is a manual upload, so a period can exist with recurring
 * commission and no sales — August 2026 is in exactly that state. The report
 * needs to say "sales not uploaded" rather than show everyone's pay as short.
 */
create or replace function public.analytics_payroll_periods()
returns table (period date, has_sales boolean, has_recurring boolean)
language sql
stable
as $$
  select
    p.period,
    exists (select 1 from public.payroll_sales_commissions s where s.period = p.period),
    exists (select 1 from public.payroll_recurring_commissions r where r.period = p.period)
  from (
    select period from public.payroll_sales_commissions
    union
    select period from public.payroll_recurring_commissions
  ) p
  group by p.period
  order by p.period desc
$$;

create or replace function public.analytics_payroll(
  p_period date,
  p_clubs text[] default null
)
returns table (
  slug text,
  employee text,
  sales_commission numeric,
  recurring_commission numeric,
  total_commission numeric,
  sales_lines bigint,
  recurring_lines bigint,
  shared_name boolean
)
language sql
stable
as $$
  with s as (
    select c.slug, public.analytics_payroll_name(x.employee_name) as k,
           -- Collapsed for display too, or the report prints 'Ryan  Harris'.
           min(regexp_replace(btrim(x.employee_name), '\s+', ' ', 'g')) as display,
           sum(x.commission) as amt, count(*)::bigint as lines
    from public.payroll_sales_commissions x
    join public.analytics_checkin_clubs() c on c.club_number = ltrim(x.club_number, '0')
    where x.period = p_period and (p_clubs is null or c.slug = any(p_clubs))
    group by 1, 2
  ),
  r as (
    select c.slug, public.analytics_payroll_name(x.employee_name) as k,
           min(regexp_replace(btrim(x.employee_name), '\s+', ' ', 'g')) as display,
           sum(x.commission) as amt, count(*)::bigint as lines
    from public.payroll_recurring_commissions x
    join public.analytics_checkin_clubs() c on c.club_number = ltrim(x.club_number, '0')
    where x.period = p_period and (p_clubs is null or c.slug = any(p_clubs))
    group by 1, 2
  )
  select
    coalesce(s.slug, r.slug),
    coalesce(s.display, r.display),
    coalesce(s.amt, 0),
    coalesce(r.amt, 0),
    coalesce(s.amt, 0) + coalesce(r.amt, 0),
    coalesce(s.lines, 0),
    coalesce(r.lines, 0),
    coalesce(s.k, r.k) like '%,%'
  from s full join r on r.slug = s.slug and r.k = s.k
  where coalesce(s.k, r.k) is not null
  order by 5 desc
$$;
