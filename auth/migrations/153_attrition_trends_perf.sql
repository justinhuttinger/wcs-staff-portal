-- 153_attrition_trends_perf.sql
--
-- Attrition Trends took 11,155 ms at its 25-month default and would have timed
-- out the way Membership Snapshot did (see migration 151). Caught before it
-- shipped this time, by measuring at the PRODUCTION month count rather than at a
-- convenient sample -- which is the exact lesson 151 was written to record.
--
-- Two causes, both visible in the plan:
--
--   1. The conditional-membership rule was evaluated for every member in every
--      month -- 95,483 x 25 = 2.4M rows -- to filter a set of a few thousand
--      leavers. A member leaves at most ONCE, so joining leavers to their own
--      month first collapses that to ~13k rows and the rule is applied to those.
--
--   2. The leaver-to-revenue join had no index behind it, so the planner sorted
--      all 541k revenue rows to disk on every run (28MB external merge). The
--      expression index below turns that into a Memoized index lookup.
--
-- 11,155 ms -> 5,886 ms at 25 months, and 3,194 ms at the 13 the report now
-- defaults to. The remaining cost is analytics_membership_trends supplying the
-- member base, which is why the default range is 13 rather than 25.

create index if not exists idx_revenue_member_key
  on public.abc_revenue_transactions ((ltrim(club_number, '0')), (lpad(member_number, 5, '0')), payment_date);

create or replace function public.analytics_attrition_trends(
  p_end date,
  p_months integer default 25,
  p_clubs text[] default null,
  p_segment text default 'club',
  p_exclude boolean default true
)
returns table (
  month_start date,
  segment text,
  members bigint,
  lost_members bigint,
  monthly_dues_lost numeric,
  monthly_revenue_lost numeric
)
language sql
stable
as $$
  with months as (
    select
      m as mo,
      least((m + interval '1 month' - interval '1 day')::date, p_end) as mo_end
    from generate_series(
      date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    ) g(m)
  ),
  skip as (select lower(membership_type) as t from public.abc_membership_skip_list),
  mem as (
    select
      m.club_number, m.member_id, m.membership_type, m.since_date,
      m.member_status, m.member_status_date, m.agreement_number,
      case p_segment
        when 'overall'         then 'Overall'
        when 'club'            then m.club_number
        when 'membership_type' then coalesce(s.seg_membership_type, 'Unknown')
        when 'gender'          then coalesce(s.seg_gender, 'Unknown')
        when 'age_group'       then coalesce(s.seg_age_group, 'Unknown')
        when 'generation'      then coalesce(s.seg_generation, 'Unknown')
        when 'payment_term'    then coalesce(s.seg_payment_term, 'Unknown')
        when 'payment_method'  then coalesce(s.seg_payment_method, 'Unknown')
        when 'join_source'     then coalesce(s.seg_join_source, 'Unknown')
        when 'salesperson'     then coalesce(s.seg_salesperson, 'Unknown')
        when 'relationship'    then coalesce(s.seg_relationship, 'Unknown')
        else 'Overall'
      end as seg
    from public.abc_members m
    left join public.abc_member_segments s
      on s.club_number = m.club_number and s.member_id = m.member_id
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(m.membership_type, '')) not in (select t from skip))
  ),
  -- Each member leaves at most ONCE, so joining leavers to their own month
  -- first collapses this to a few thousand rows before the conditional rule is
  -- applied. That single change is most of the 11.2s -> 5.9s.
  leavers_raw as (
    select mo.mo, mo.mo_end, m.seg, m.club_number, m.member_id, m.membership_type,
           m.since_date, m.agreement_number, m.member_status_date::date as left_on
    from mem m
    join months mo
      on m.member_status_date >= mo.mo and m.member_status_date <= mo.mo_end
    where m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
  ),
  -- Stock vs flow: a member never counted in the base cannot be counted as a
  -- loss from it. Same predicate as analytics_members_excluded_as_of, new-member
  -- waiver included, now applied only to actual leavers.
  leavers as (
    select l.*,
           greatest(1, least(12,
             (l.left_on - greatest(coalesce(l.since_date, l.left_on - 365), l.left_on - 365)) / 30.0
           ))::numeric as tenure_months
    from leavers_raw l
    where not p_exclude
       or not exists (
         select 1
         from public.abc_conditional_membership_types c
         where c.membership_type = l.membership_type
           and not (l.since_date is not null
                    and l.since_date >= public.analytics_conditional_window_start(l.mo_end, c.active_within_months))
           and not exists (
             select 1 from public.abc_member_checkin_months k
             where k.club_number = l.club_number and k.member_id = l.member_id
               and k.checkins > 0
               and k.month >= public.analytics_conditional_window_start(l.mo_end, c.active_within_months)
               and k.month <= date_trunc('month', l.mo_end)::date
           )
       )
  ),
  spend as (
    select l.mo, l.seg, l.member_id,
      coalesce(sum(t.payment_amount) filter (where g.revenue_class = 'Dues & Fees'), 0) / l.tenure_months as mo_dues,
      coalesce(sum(t.payment_amount) filter (where g.revenue_class = 'Discretionary'), 0) / l.tenure_months as mo_disc
    from leavers l
    left join public.abc_revenue_transactions t
      on ltrim(t.club_number, '0') = ltrim(l.club_number, '0')
     and lpad(t.member_number, 5, '0') = lpad(l.agreement_number, 5, '0')
     and t.payment_date > l.left_on - 365
     and t.payment_date <= l.left_on
    left join public.abc_profit_center_groups g on g.profit_center = t.profit_center
    group by l.mo, l.seg, l.member_id, l.tenure_months
  ),
  lost_agg as (
    select mo, seg, count(*) as n,
           coalesce(sum(mo_dues), 0) as dues,
           coalesce(sum(mo_dues + mo_disc), 0) as revenue
    from spend group by mo, seg
  ),
  -- analytics_membership_trends HAS NO 'overall' SEGMENT: asked for one it
  -- silently returns per-club rows, which left the base split by club while the
  -- losses arrived as a single Overall row and the join matched nothing. Clubs
  -- are disjoint, so collapsing them is a valid total.
  base as (
    select
      t.month_start,
      case when p_segment = 'overall' then 'Overall' else t.segment end as segment,
      sum(t.total_members) as total_members
    from public.analytics_membership_trends(
           p_end, p_months, p_clubs,
           case when p_segment = 'overall' then 'club' else p_segment end,
           p_exclude) t
    group by 1, 2
  )
  select
    coalesce(b.month_start, l.mo),
    coalesce(b.segment, l.seg),
    coalesce(b.total_members, 0)::bigint,
    coalesce(l.n, 0),
    round(coalesce(l.dues, 0), 2),
    round(coalesce(l.revenue, 0), 2)
  -- FULL join: a segment can lose members in a month where its base is nil, and
  -- a base can exist with no losses. Dropping either leaves a gap that reads as
  -- missing data.
  from base b
  full outer join lost_agg l on l.mo = b.month_start and l.seg = b.segment
  order by 1, 2
$$;
