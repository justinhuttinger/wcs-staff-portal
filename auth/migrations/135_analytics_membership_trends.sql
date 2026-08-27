-- 135: shared member segment definitions, and Membership Trends.
--
-- THE VIEW
--
-- The same nested CASE that turns a member into a segment was already copied
-- into analytics_revenue_per_member and was about to be copied into four more
-- reports. Copied five times it becomes five subtly different definitions of
-- "Millennial", so it lives in one view and the reports select a column.
--
-- AGE AND GENERATION ARE AS OF TODAY, not as of the month being charted. A
-- member who turned 35 last week is in 35-44 for their whole history.
-- Bucketing by age-at-the-time would move members between series every month
-- and make a trend line unreadable, and it matches how these reports already
-- describe membership type: the plan they hold TODAY.

create or replace view public.abc_member_segments as
select
  m.club_number,
  m.member_id,
  ltrim(m.club_number, '0')      as club_key,
  ltrim(m.agreement_number, '0') as agr_key,
  m.membership_type,
  m.since_date,
  m.member_status,
  m.member_status_date,

  coalesce(nullif(trim(m.membership_type), ''), 'Unknown')            as seg_membership_type,
  coalesce(nullif(trim(m.gender), ''), 'Unknown')                     as seg_gender,
  coalesce(nullif(trim(m.agreement_term), ''), 'Unknown')             as seg_payment_term,
  coalesce(nullif(trim(m.agreement_payment_method), ''), 'Unknown')   as seg_payment_method,
  coalesce(nullif(trim(m.agreement_entry_source), ''), 'Unknown')     as seg_join_source,
  coalesce(
    nullif(regexp_replace(trim(coalesce(m.sales_person_name, '')), '\s+', ' ', 'g'), ''),
    'Unknown'
  )                                                                   as seg_salesperson,

  case
    when m.is_primary_member is true  then 'Primary'
    when m.is_primary_member is false then 'Secondary / Dependent'
    else 'Unknown'
  end                                                                 as seg_relationship,

  case
    when m.birth_date is null then 'Unknown'
    when extract(year from age(current_date, m.birth_date)) < 18 then 'Under 18'
    when extract(year from age(current_date, m.birth_date)) < 25 then '18-24'
    when extract(year from age(current_date, m.birth_date)) < 35 then '25-34'
    when extract(year from age(current_date, m.birth_date)) < 45 then '35-44'
    when extract(year from age(current_date, m.birth_date)) < 55 then '45-54'
    when extract(year from age(current_date, m.birth_date)) < 65 then '55-64'
    else '65+'
  end                                                                 as seg_age_group,

  case
    when m.birth_date is null then 'Unknown'
    when extract(year from m.birth_date) >= 2013 then 'Gen Alpha'
    when extract(year from m.birth_date) >= 1997 then 'Gen Z'
    when extract(year from m.birth_date) >= 1981 then 'Millennial'
    when extract(year from m.birth_date) >= 1965 then 'Gen X'
    when extract(year from m.birth_date) >= 1946 then 'Boomer'
    else 'Silent'
  end                                                                 as seg_generation
from public.abc_members m;

comment on view public.abc_member_segments is
  'Single definition of every member segment used by the Analytics reports. Age and generation are as of TODAY, so a member keeps one bucket across their whole history rather than moving between series each month.';

-- ---------------------------------------------------------------------------
-- Membership Trends
--
-- Total members (a stock) and new members (a flow) per month, split by one
-- segment. Same three rules as every other member report, so the numbers tie
-- out with Club Activity and Topline:
--
--   * the conditional membership rule applies to the STOCK (migration 132)
--   * NEW members never take it — joining is a fact about the day it happened
--   * the series starts at the first month the rule can answer, so the line has
--     no step where the check-in backfill happens to begin
--
-- Verified: July 2026 by club sums to 17,080 total and 701 new, matching
-- analytics_club_activity exactly.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_membership_trends(
  p_end     date,
  p_months  integer default 25,
  p_clubs   text[]  default null,
  p_segment text    default 'club',
  p_exclude boolean default true
)
returns table (
  month_start   date,
  segment       text,
  total_members bigint,
  new_members   bigint
)
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  mem as (
    select
      s.club_number, s.member_id, s.since_date, s.member_status, s.member_status_date,
      s.membership_type,
      case p_segment
        when 'membership_type' then s.seg_membership_type
        when 'gender'          then s.seg_gender
        when 'age_group'       then s.seg_age_group
        when 'generation'      then s.seg_generation
        when 'payment_term'    then s.seg_payment_term
        when 'payment_method'  then s.seg_payment_method
        when 'join_source'     then s.seg_join_source
        when 'salesperson'     then s.seg_salesperson
        when 'relationship'    then s.seg_relationship
        -- Club is emitted as the club NUMBER; the route maps it to a name, the
        -- same mapping every other report uses.
        else s.club_number
      end as seg
    from public.abc_member_segments s
    where (p_clubs is null or s.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(s.membership_type, '')) not in (select t from skip))
  ),
  months as (
    select
      mo::date,
      (mo + interval '1 month - 1 day')::date as mo_end
    from generate_series(
      (
        select case
          when p_exclude then greatest(
            date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
            min(k.month) + interval '2 months'
          )
          else date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval
        end
        from public.abc_member_checkin_months k
      ),
      date_trunc('month', p_end)::date,
      '1 month'
    ) as g(mo)
  ),
  cond as (
    select m.club_number, m.member_id, m.since_date, c.active_within_days
    from mem m
    join public.abc_conditional_membership_types c
      on c.membership_type = m.membership_type
  ),
  live as (
    select distinct mo.mo, k.club_number, k.member_id
    from months mo
    join public.abc_member_checkin_months k
      on k.checkins > 0
     and k.month >= date_trunc('month', mo.mo_end - 60)::date
     and k.month <= mo.mo
  ),
  dead as (
    select mo.mo, c.club_number, c.member_id
    from months mo
    cross join cond c
    where not (c.since_date is not null and c.since_date > (mo.mo_end - c.active_within_days))
      and not exists (
        select 1 from live l
        where l.mo = mo.mo and l.club_number = c.club_number and l.member_id = c.member_id
      )
  ),
  -- LEFT JOIN ... IS NULL with p_exclude in the ON clause, so the planner keeps
  -- one hash anti-join; NOT EXISTS inside an OR rescans `dead` per member per
  -- month and times out. See migration 132.
  stock as (
    select months.mo, mem.seg, count(*) as n
    from months
    join mem
      on mem.since_date <= months.mo_end
     and not (
       mem.member_status in ('Cancelled', 'Expired', 'Return For Collection')
       and mem.member_status_date <= months.mo_end
     )
    left join dead d
      on p_exclude and d.mo = months.mo
     and d.club_number = mem.club_number and d.member_id = mem.member_id
    where d.member_id is null
    group by 1, 2
  ),
  joined as (
    select months.mo, mem.seg, count(*) as n
    from months
    join mem
      on mem.since_date >= months.mo
     and mem.since_date < months.mo + interval '1 month'
    group by 1, 2
  )
  -- FULL OUTER, so a segment that gained members in a month it had no stock in
  -- (and the reverse) still appears rather than being silently dropped.
  select
    coalesce(stock.mo, joined.mo)   as month_start,
    coalesce(stock.seg, joined.seg) as segment,
    coalesce(stock.n, 0)            as total_members,
    coalesce(joined.n, 0)           as new_members
  from stock
  full outer join joined on joined.mo = stock.mo and joined.seg = stock.seg
  order by 1, 2;
$function$;
