-- 140: Revenue Per Member counts ALL revenue, while the member list keeps its
-- filters.
--
-- WHAT WAS WRONG
--
-- The report matched revenue to members through the agreement number and then
-- silently dropped whatever did not match. For July 2026 that was $66,436 of
-- $904,228 — 7.3% of the month — so the report disagreed with Club Activity,
-- Revenue Trends, Revenue by Profit Center and the raw transactions, all four
-- of which agreed with each other at $904,228.
--
-- Two separate leaks, both now closed:
--
--   $36,538  no agreement match at all: guests, non-members, purged accounts.
--   $32,729  matched a member on the membership-type skip list, whose whole
--            agreement was therefore excluded from the join.
--   -$2,831  partly offset because the old split divided a shared agreement's
--            payment across only its NON-skip-listed members, handing the
--            excluded member's share to whoever was left. A couple where one
--            member is skip-listed had the other absorbing the full payment.
--
-- WHAT IT DOES NOW
--
-- Revenue is the whole of it. The denominator is unchanged: still the counted
-- members, still the skip list, still the conditional membership rule. That is
-- the question the report is named after — what we take per member we count —
-- and it makes the total tie out with every other revenue report.
--
-- Revenue that belongs to nobody we count lands in one explicit bucket,
-- 'Unattributed / Excluded', with a member count of 0. It is NOT hidden and it
-- is NOT smeared across the real segments. Its rate renders as N/A rather than
-- as a division by zero, and the route drops it from the ranked series so it
-- can never take a line on the chart.
--
-- A shared agreement is now split across ALL its members, not just the counted
-- ones, so an excluded member's share goes to the bucket instead of inflating
-- the member beside them.
--
-- Verified after applying: July 2026 sums to $904,228, matching the raw
-- transaction total and the other three revenue reports exactly.

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
  -- The counted membership: the DENOMINATOR only.
  mem as (
    select
      s.club_number, s.member_id, s.club_key, s.agr_key, s.membership_type,
      s.since_date, s.member_status, s.member_status_date,
      case p_breakdown
        when 'gender'         then s.seg_gender
        when 'payment_term'   then s.seg_payment_term
        when 'payment_method' then s.seg_payment_method
        when 'join_source'    then s.seg_join_source
        when 'salesperson'    then s.seg_salesperson
        when 'relationship'   then s.seg_relationship
        when 'age_group'      then s.seg_age_group
        when 'generation'     then s.seg_generation
        else s.seg_membership_type
      end as segment
    from public.abc_member_segments s
    where (p_clubs is null or s.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(s.membership_type, '')) not in (select t from skip))
  ),
  -- EVERY member on an agreement, filtered by nothing. This is what a payment
  -- is divided by, so an excluded member still takes their share out of the
  -- attributed total rather than leaving it to the member beside them.
  agr_all as (
    select
      s.club_number, s.member_id, s.club_key, s.agr_key,
      count(*) over (partition by s.club_key, s.agr_key) as members_on_agreement
    from public.abc_member_segments s
    where s.agr_key is not null and s.agr_key <> ''
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
  -- ALL revenue in range. A transaction fans out to every member on its
  -- agreement and each takes an equal share; a transaction matching no
  -- agreement stays whole. Either way the shares add back to the payment, so
  -- the report totals to the real figure.
  rev as (
    select
      date_trunc('month', r.payment_date)::date as mo,
      coalesce(m.segment, 'Unattributed / Excluded') as segment,
      sum(r.payment_amount / coalesce(a.members_on_agreement, 1)) as revenue
    from public.abc_revenue_transactions r
    left join agr_all a
      on a.club_key = ltrim(r.club_number, '0')
     and a.agr_key  = ltrim(r.member_number, '0')
    left join mem m
      on m.club_number = a.club_number
     and m.member_id   = a.member_id
    where r.payment_date >= (select min(mo) from months)
      and r.payment_date <= p_end
      and (p_clubs is null or ltrim(r.club_number, '0') = any(select ltrim(c, '0') from unnest(p_clubs) c))
    group by 1, 2
  ),
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
      on p_exclude and d.mo = months.mo
     and d.club_number = mem.club_number and d.member_id = mem.member_id
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
