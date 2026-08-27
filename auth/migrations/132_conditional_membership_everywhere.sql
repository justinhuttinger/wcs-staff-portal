-- 132: apply the conditional membership rule to every report that counts members.
--
-- THE RULE
--
-- A2 CORE and Active and Fit Limited are insurance plans. They bill whether or
-- not anybody turns up, and mostly nobody does: 9.5% and 12.4% of them checked
-- in within 60 days, against 66.4% on every other plan. Counting them as
-- members inflates headcount by ~2,600 and drags every per-member rate down.
--
-- So they count only if they are LIVE, where live means a check-in inside the
-- last 60 days. This is a check-in test rather than a blanket plan exclusion on
-- purpose: A2 EXEC is also an insurance plan and 76% of its members DO come in,
-- so excluding by plan name would delete real members.
--
-- Migration 126 added the rule for TODAY (the abc_members_counted view). This
-- migration gives it a past tense, and applies it across the reports.
--
-- THE NEW-MEMBER WAIVER
--
-- A member inside their first 60 days has not had the window the rule measures,
-- so failing it means nothing. Without a waiver every new A2 CORE and Active
-- and Fit Limited sale would be invisible on the day it was made, which is
-- exactly when the salesperson and new-member reports need to see it.
--
-- STOCK vs FLOW — which reports change, and which correctly do not
--
--   Stock (a headcount at a moment) takes the rule:
--     analytics_topline_members_as_of, analytics_club_activity.total_members,
--     analytics_revenue_per_member.members, analytics_pt_penetration_v2.members
--
--   Flow IN (somebody joined) NEVER takes it. Joining is a fact about the day
--   it happened, not about whether they have used the place since. So
--   new_member_units, new_members, and the whole of PT Scorecard and
--   Salesperson Performance — which count only new business — are unchanged.
--   Applying a 60-day liveness test to "who sold what this month" would delete
--   this month's sales.
--
--   Flow OUT (somebody left) DOES take it, at the same date the surrounding
--   headcount uses. A member who was never counted cannot also be counted as a
--   loss, or attrition is measured against a base that never contained them.
--
-- WHERE THE SERIES NOW STARTS
--
-- abc_member_checkin_months begins at 2024-07 and the rule needs 60 days of
-- history, so the earliest month it can answer is 2024-09. Charting earlier
-- months with the rule switched off was tried and is worse: the line steps from
-- 13,022 to 10,645 at the boundary, a cliff that is an artefact of how far the
-- backfill reaches rather than anything that happened. The three trend reports
-- therefore start their series at the first answerable month, so every point is
-- measured the same way. Consequence worth knowing: Include shows more months
-- than Exclude, because Include has no rule to be limited by.
--
-- Verified after applying: Club Activity, Revenue Per Member and PT Penetration
-- return identical member counts for every shared month (10,645 / 10,853 /
-- 11,254 / ... / 16,921 / 17,080), and Club Activity's books balance
-- (16,921 + 701 new - 539 lost = 17,083 against a reported 17,080).

-- ---------------------------------------------------------------------------
-- The helper: the COMPLEMENT of "counts as a member", because the complement is
-- tiny. Only two membership types are conditional, ~2,900 members out of
-- 97,000, and most fail the rule. Asking "who is excluded" scans 2,900 rows via
-- the inner join; asking "who counts" scans all 97,000.
--
-- The reports below do NOT call this function: called inline it is re-executed
-- once per member row and times out. They inline the same logic set-based. It
-- is kept as the readable statement of the rule and for ad-hoc checks.
-- ---------------------------------------------------------------------------

drop function if exists public.analytics_members_counted_as_of(date);

create or replace function public.analytics_members_excluded_as_of(p_asof date)
returns table (club_number text, member_id text)
language sql
stable
as $$
  select m.club_number, m.member_id
  from public.abc_members m
  join public.abc_conditional_membership_types c
    on c.membership_type = m.membership_type
  where
    not (m.since_date is not null and m.since_date > (p_asof - c.active_within_days))
    and not exists (
      select 1
      from public.abc_member_checkin_months k
      where k.club_number = m.club_number
        and k.member_id = m.member_id
        and k.checkins > 0
        and k.month >= date_trunc('month', (p_asof - c.active_within_days))::date
        and k.month <= date_trunc('month', p_asof)::date
    );
$$;

comment on function public.analytics_members_excluded_as_of is
  'Conditional membership rule for a PAST date: A2 CORE and Active and Fit Limited members who were NOT live as of p_asof. Live means a check-in inside the window OR still within the first 60 days. Month granularity makes the test slightly lenient at both window edges; leniency is the safe direction, since dropping a real member is worse than keeping a lapsed one.';

-- ---------------------------------------------------------------------------
-- Topline
-- ---------------------------------------------------------------------------

create or replace function public.analytics_topline_members_as_of(
  p_at      date,
  p_clubs   text[]  default null,
  p_exclude boolean default true
)
returns bigint
language sql
stable
as $$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  dead as (
    select * from public.analytics_members_excluded_as_of(p_at)
  )
  select count(*)
  from public.abc_members m
  where (p_clubs is null or m.club_number = any(p_clubs))
    and (
      not p_exclude
      or lower(coalesce(m.membership_type, '')) not in (select t from skip)
    )
    -- The conditional rule rides the same Exclude toggle as the skip list: both
    -- answer "who do we count as a member", and splitting them into two
    -- switches would let a reader produce a fourth combination nobody means.
    and (
      not p_exclude
      or not exists (
        select 1 from dead d
        where d.club_number = m.club_number and d.member_id = m.member_id
      )
    )
    and m.since_date <= p_at
    and not (
      m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
      and m.member_status_date <= p_at
    );
$$;

create or replace function public.analytics_topline_window(
  p_start   date,
  p_end     date,
  p_clubs   text[]  default null,
  p_exclude boolean default true
)
returns table (
  new_members      bigint,
  lost_members     bigint,
  new_dues         numeric,
  revenue          numeric,
  pt_revenue       numeric,
  checkins         bigint,
  has_checkin_data boolean
)
language sql
stable
as $$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  dead as (
    select * from public.analytics_members_excluded_as_of(p_end)
  ),
  mem as (
    select m.*
    from public.abc_members m
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (
        not p_exclude
        or lower(coalesce(m.membership_type, '')) not in (select t from skip)
      )
  ),
  -- See the header on stock vs flow: new members never take the rule, losses do.
  live as (
    select m.* from mem m
    where not p_exclude
       or not exists (
         select 1 from dead d
         where d.club_number = m.club_number and d.member_id = m.member_id
       )
  )
  select
    (select count(*) from mem where since_date between p_start and p_end),
    (select count(*) from live
      where member_status in ('Cancelled', 'Expired', 'Return For Collection')
        and member_status_date between p_start and p_end),
    (select coalesce(sum(next_due_amount), 0) from mem where since_date between p_start and p_end),
    (select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
      where r.payment_date between p_start and p_end
        and (p_clubs is null or r.club_number = any(p_clubs))),
    (select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
      where r.payment_date between p_start and p_end
        and r.profit_center = 'TRAINING'
        and (p_clubs is null or r.club_number = any(p_clubs))),
    -- Still present for shape; the Topline check-in card reads the whole-month
    -- block added in migration 131 instead of these two columns.
    (select coalesce(sum(c.total_checkins), 0) from public.checkins_hourly c
      where c.hour_start >= p_start
        and c.hour_start < (p_end + 1)
        and (p_clubs is null or c.club_number = any(p_clubs))),
    (p_start >= (select min(hour_start)::date from public.checkins_hourly));
$$;

-- ---------------------------------------------------------------------------
-- Club Activity Trends
-- ---------------------------------------------------------------------------

create or replace function public.analytics_club_activity(
  p_end     date,
  p_months  integer default 25,
  p_clubs   text[]  default null,
  p_exclude boolean default true
)
returns table (
  month_start      date,
  total_members    bigint,
  new_member_units bigint,
  lost_members     bigint,
  total_checkins   bigint,
  unique_checkins  bigint,
  total_revenue    numeric,
  pt_revenue       numeric,
  has_checkin_data boolean
)
language sql
stable
as $$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  mem as (
    select m.*
    from public.abc_members m
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (
        not p_exclude
        or lower(coalesce(m.membership_type, '')) not in (select t from skip)
      )
  ),
  -- The series starts at the first month the rule can answer; see the header.
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
  -- THE RULE, AS A CORRECTION TERM.
  --
  -- Testing every member against it was tried and timed out: 17,000 members x
  -- 25 months of anti-join, with the helper function re-executed per row. Only
  -- ~2,900 members are on a conditional plan, so the counts below are taken
  -- WITHOUT the rule and the excluded few subtracted. Same answer, two orders
  -- of magnitude less work.
  cond as (
    select m.club_number, m.member_id, m.since_date, m.member_status,
           m.member_status_date, c.active_within_days
    from mem m
    join public.abc_conditional_membership_types c
      on c.membership_type = m.membership_type
  ),
  -- Live at a month end means a check-in in the 60 days before it. At month
  -- granularity that is the month itself and the two before it, which is the
  -- widest the window ever reaches.
  live as (
    select distinct mo.mo, k.club_number, k.member_id
    from months mo
    join public.abc_member_checkin_months k
      on k.checkins > 0
     and k.month >= date_trunc('month', mo.mo_end - 60)::date
     and k.month <= mo.mo
  ),
  dead as (
    select mo.mo, mo.mo_end, c.*
    from months mo
    cross join cond c
    where not (c.since_date is not null and c.since_date > (mo.mo_end - c.active_within_days))
      and not exists (
        select 1 from live l
        where l.mo = mo.mo and l.club_number = c.club_number and l.member_id = c.member_id
      )
  ),
  stock_adj as (
    select d.mo, count(*)::bigint as n
    from dead d
    where d.since_date <= d.mo_end
      and not (
        d.member_status in ('Cancelled', 'Expired', 'Return For Collection')
        and d.member_status_date <= d.mo_end
      )
    group by 1
  ),
  lost_adj as (
    select d.mo, count(*)::bigint as n
    from dead d
    where d.member_status in ('Cancelled', 'Expired', 'Return For Collection')
      and d.member_status_date >= d.mo
      and d.member_status_date < d.mo + interval '1 month'
    group by 1
  ),
  checkin_floor as (
    select min(month) as first_month from public.abc_member_checkin_months
  ),
  checkins as (
    select c.month, sum(c.checkins) as total_checkins, count(distinct c.member_id) as unique_members
    from public.abc_member_checkin_months c
    where (p_clubs is null or c.club_number = any(p_clubs))
    group by 1
  )
  select
    mo as month_start,
    (
      select count(*) from mem
      where since_date <= mo_end
        and not (
          member_status in ('Cancelled', 'Expired', 'Return For Collection')
          and member_status_date <= mo_end
        )
    ) - (case when p_exclude then coalesce((select n from stock_adj where stock_adj.mo = months.mo), 0) else 0 end) as total_members,
    -- Flow IN: no correction. Somebody joined.
    (
      select count(*) from mem
      where since_date >= mo and since_date < mo + interval '1 month'
    ) as new_member_units,
    -- Flow OUT of the stock, so it takes the same correction the stock does.
    (
      select count(*) from mem
      where member_status in ('Cancelled', 'Expired', 'Return For Collection')
        and member_status_date >= mo
        and member_status_date < mo + interval '1 month'
    ) - (case when p_exclude then coalesce((select n from lost_adj where lost_adj.mo = months.mo), 0) else 0 end) as lost_members,
    coalesce((select total_checkins from checkins where checkins.month = mo), 0) as total_checkins,
    coalesce((select unique_members from checkins where checkins.month = mo), 0) as unique_checkins,
    (
      select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
      where r.payment_date >= mo and r.payment_date < mo + interval '1 month'
        and (p_clubs is null or r.club_number = any(p_clubs))
    ) as total_revenue,
    (
      select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
      where r.payment_date >= mo and r.payment_date < mo + interval '1 month'
        and r.profit_center = 'TRAINING'
        and (p_clubs is null or r.club_number = any(p_clubs))
    ) as pt_revenue,
    (mo >= (select first_month from checkin_floor)) as has_checkin_data
  from months
  order by mo;
$$;

-- ---------------------------------------------------------------------------
-- Revenue Per Member
-- ---------------------------------------------------------------------------

create or replace function public.analytics_revenue_per_member(
  p_end       date,
  p_months    integer default 25,
  p_clubs     text[]  default null,
  p_breakdown text    default 'membership_type',
  p_exclude   boolean default true
)
returns table (month_start date, segment text, revenue numeric, members bigint)
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  mem as (
    select
      m.*,
      ltrim(m.club_number, '0')      as club_key,
      ltrim(m.agreement_number, '0') as agr_key,
      case p_breakdown
        when 'gender'         then coalesce(nullif(trim(m.gender), ''), 'Unknown')
        when 'payment_term'   then coalesce(nullif(trim(m.agreement_term), ''), 'Unknown')
        when 'payment_method' then coalesce(nullif(trim(m.agreement_payment_method), ''), 'Unknown')
        when 'join_source'    then coalesce(nullif(trim(m.agreement_entry_source), ''), 'Unknown')
        when 'salesperson'    then coalesce(nullif(regexp_replace(trim(coalesce(m.sales_person_name, '')), '\s+', ' ', 'g'), ''), 'Unknown')
        when 'relationship'   then case
                                     when m.is_primary_member is true then 'Primary'
                                     when m.is_primary_member is false then 'Secondary / Dependent'
                                     else 'Unknown' end
        when 'age_group'      then case
                                     when m.birth_date is null then 'Unknown'
                                     when extract(year from age(p_end, m.birth_date)) < 18 then 'Under 18'
                                     when extract(year from age(p_end, m.birth_date)) < 25 then '18-24'
                                     when extract(year from age(p_end, m.birth_date)) < 35 then '25-34'
                                     when extract(year from age(p_end, m.birth_date)) < 45 then '35-44'
                                     when extract(year from age(p_end, m.birth_date)) < 55 then '45-54'
                                     when extract(year from age(p_end, m.birth_date)) < 65 then '55-64'
                                     else '65+' end
        when 'generation'     then case
                                     when m.birth_date is null then 'Unknown'
                                     when extract(year from m.birth_date) >= 2013 then 'Gen Alpha'
                                     when extract(year from m.birth_date) >= 1997 then 'Gen Z'
                                     when extract(year from m.birth_date) >= 1981 then 'Millennial'
                                     when extract(year from m.birth_date) >= 1965 then 'Gen X'
                                     when extract(year from m.birth_date) >= 1946 then 'Boomer'
                                     else 'Silent' end
        else coalesce(nullif(trim(m.membership_type), ''), 'Unknown')
      end as segment
    from public.abc_members m
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(m.membership_type, '')) not in (select t from skip))
  ),
  agr as (
    select club_key, agr_key, segment,
           count(*) over (partition by club_key, agr_key) as members_on_agreement
    from mem
    where agr_key is not null and agr_key <> ''
  ),
  -- The series starts at the first month the rule can answer; see the header.
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
  rev as (
    select date_trunc('month', r.payment_date)::date as mo,
           a.segment,
           sum(r.payment_amount / a.members_on_agreement) as revenue
    from public.abc_revenue_transactions r
    join agr a
      on a.club_key = ltrim(r.club_number, '0')
     and a.agr_key  = ltrim(r.member_number, '0')
    where r.payment_date >= (select min(mo) from months)
      and r.payment_date <= p_end
      and (p_clubs is null or ltrim(r.club_number, '0') = any(select ltrim(c, '0') from unnest(p_clubs) c))
    group by 1, 2
  ),
  -- The member count is a STOCK, so it takes the rule at each month end.
  -- Revenue is deliberately NOT adjusted: a payment that cleared is money we
  -- received whether or not the payer counts as a member. Revenue per member
  -- therefore rises for the conditional plans, which is the honest reading of a
  -- plan that bills people who never come in.
  --
  -- LEFT JOIN ... IS NULL, not NOT EXISTS. The NOT EXISTS form was tried and
  -- timed out: with p_exclude in the same OR the planner cannot turn it into a
  -- hash anti-join and rescans `dead` once per member per month. Putting
  -- p_exclude in the ON clause keeps it one hash join, and when p_exclude is
  -- false the condition simply never matches.
  base as (
    select months.mo, mem.segment, count(*) as members
    from months
    join mem
      on mem.since_date <= months.mo_end
     and not (
       mem.member_status in ('Cancelled', 'Expired', 'Return For Collection')
       and mem.member_status_date <= months.mo_end
     )
    left join dead d
      on p_exclude
     and d.mo = months.mo
     and d.club_number = mem.club_number
     and d.member_id = mem.member_id
    where d.member_id is null
    group by 1, 2
  )
  select
    coalesce(base.mo, rev.mo)                as month_start,
    coalesce(base.segment, rev.segment)      as segment,
    coalesce(rev.revenue, 0)                 as revenue,
    coalesce(base.members, 0)                as members
  from base
  full outer join rev on rev.mo = base.mo and rev.segment = base.segment
  order by 1, 2;
$function$;

-- ---------------------------------------------------------------------------
-- PT Penetration
-- ---------------------------------------------------------------------------

create or replace function public.analytics_pt_penetration_v2(
  p_end        date,
  p_months     integer default 32,
  p_clubs      text[]  default null,
  p_pif_months integer default 3,
  p_exclude    boolean default true
)
returns table (
  month_start          date,
  club_number          text,
  members              bigint,
  pt_members           bigint,
  recurring_pt_members bigint,
  pif_pt_members       bigint
)
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  mem as (
    select m.club_number, m.member_id, m.membership_type, m.since_date,
           m.member_status, m.member_status_date
    from public.abc_members m
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(m.membership_type, '')) not in (select t from skip))
  ),
  -- The series starts at the first month the rule can answer; see the header.
  -- This report asks for 32 months and gets ~24, which is the honest number.
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
  clubs as (select distinct club_number from mem),
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
  svc as (
    select s.*,
           (s.recurring_type_desc ilike '%paid in full%') as is_pif
    from public.abc_pt_services s
    where (p_clubs is null or s.club_number = any(p_clubs))
      and s.sale_date is not null
  ),
  -- BOTH sides of the ratio take the rule, so penetration stays a share of the
  -- same population. Excluding a member from the denominator but leaving their
  -- PT service in the numerator could put penetration above 100%.
  base as (
    select months.mo, mem.club_number, count(*) as members
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
  active as (
    select
      months.mo,
      svc.club_number,
      svc.member_id,
      bool_or(not svc.is_pif) as has_recurring,
      bool_or(svc.is_pif)     as has_pif
    from months
    join svc
      on svc.sale_date <= months.mo_end
     and (
       (not svc.is_pif and (svc.inactive_date is null or svc.inactive_date >= months.mo))
       or
       (svc.is_pif and svc.sale_date >= (months.mo - ((p_pif_months - 1) || ' months')::interval))
     )
    left join dead d
      on p_exclude and d.mo = months.mo
     and d.club_number = svc.club_number and d.member_id = svc.member_id
    where d.member_id is null
    group by 1, 2, 3
  ),
  agg as (
    select mo, club_number,
           count(*) as pt_members,
           count(*) filter (where has_recurring) as recurring_pt_members,
           count(*) filter (where has_pif) as pif_pt_members
    from active
    group by 1, 2
  )
  select
    months.mo as month_start,
    clubs.club_number,
    coalesce(base.members, 0),
    coalesce(agg.pt_members, 0),
    coalesce(agg.recurring_pt_members, 0),
    coalesce(agg.pif_pt_members, 0)
  from months
  cross join clubs
  left join base on base.mo = months.mo and base.club_number = clubs.club_number
  left join agg  on agg.mo = months.mo  and agg.club_number = clubs.club_number
  order by 1, 2;
$function$;
