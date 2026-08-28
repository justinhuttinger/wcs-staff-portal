-- 152_analytics_attrition_trends.sql
--
-- Analytics > Attrition Trends. Month by month, overall and by segment:
-- how many members left, what share of the base that was, and what their dues
-- and total spend were worth.
--
-- THE BASE IS NOT RECOMPUTED. analytics_membership_trends already returns
-- total_members per month per segment, with the conditional-membership rule
-- applied, in a single set-based pass. It is called ONCE here and joined, not
-- called per month -- see migration 151 for what per-month calling costs.
--
-- WHY DUES CANNOT COME FROM next_due_amount.
--
-- ABC zeroes that field when a membership ends: 507 of the 580 members lost in
-- August 2026 carry 0 or null, 87%. Summing it would report a month's lost dues
-- as roughly an eighth of the truth. So dues are reconstructed from what the
-- member ACTUALLY PAID, out of abc_revenue_transactions, split by
-- abc_profit_center_groups.revenue_class.
--
-- The join is club + agreement number, not member id: revenue rows carry a
-- member_number that matches abc_members.agreement_number zero-padded to five,
-- under a club_number that is itself zero-padded. 94.7% of lost members match.
-- Those that do not contribute nothing rather than a guess.
--
-- AVERAGED OVER TENURE, NOT OVER A FLAT TWELVE MONTHS. A member who joined in
-- May and left in August paid three months of dues; dividing that by twelve
-- would report them as a quarter of the member they were. The divisor is the
-- months they were actually there, capped at twelve and floored at one.
--
-- STOCK vs FLOW is preserved from analytics_topline_window: members leaving are
-- a flow OUT of the stock, so they take the conditional test. Somebody who was
-- never counted in the base cannot be counted as a loss from it.

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
  -- Scanned once for the whole series, with its segment already resolved.
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
  -- The conditional rule for every month in one pass. Same predicate as
  -- analytics_members_excluded_as_of, including the new-member waiver.
  excluded as (
    select mo.mo, m.club_number, m.member_id
    from mem m
    join public.abc_conditional_membership_types c
      on c.membership_type = m.membership_type
    cross join months mo
    where p_exclude
      and not (
        m.since_date is not null
        and m.since_date >= public.analytics_conditional_window_start(mo.mo_end, c.active_within_months)
      )
      and not exists (
        select 1 from public.abc_member_checkin_months k
        where k.club_number = m.club_number and k.member_id = m.member_id
          and k.checkins > 0
          and k.month >= public.analytics_conditional_window_start(mo.mo_end, c.active_within_months)
          and k.month <= date_trunc('month', mo.mo_end)::date
      )
  ),
  leavers as (
    select mo.mo, m.seg, m.club_number, m.member_id, m.agreement_number,
           m.member_status_date::date as left_on,
           -- Months actually spent as a member inside the trailing year, so a
           -- short-tenure member is not averaged as if they had a full one.
           greatest(1, least(12,
             (m.member_status_date::date
              - greatest(coalesce(m.since_date::date, m.member_status_date::date - 365),
                         m.member_status_date::date - 365)) / 30.0
           ))::numeric as tenure_months
    from mem m
    cross join months mo
    where m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
      and m.member_status_date between mo.mo and mo.mo_end
      and not exists (
        select 1 from excluded e
        where e.mo = mo.mo and e.club_number = m.club_number and e.member_id = m.member_id
      )
  ),
  -- What each leaver actually paid in their last year, split dues vs the rest.
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
  -- silently returns per-club rows. Left unhandled, the base came back split by
  -- club while the losses came back as a single Overall row, and the join below
  -- matched nothing -- every month showed a base with no losses beside losses
  -- with no base. Clubs are disjoint, so collapsing them is a valid total; that
  -- was checked when analytics_topline_window was shown to equal the sum of
  -- analytics_net_membership across the seven clubs.
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
    coalesce(b.total_members, 0),
    coalesce(l.n, 0),
    round(coalesce(l.dues, 0), 2),
    round(coalesce(l.revenue, 0), 2)
  -- FULL join: a segment can lose members in a month where its base rounds to
  -- nothing, and a base can exist with no losses. Dropping either would leave a
  -- gap in the line that reads as missing data.
  from base b
  full outer join lost_agg l on l.mo = b.month_start and l.seg = b.segment
  order by 1, 2
$$;

-- SUPERSEDED IN PART BY MIGRATION 153.
--
-- The version above applied the conditional-membership rule across every member
-- in every month -- 95,483 x 25 = 2.4M rows -- in order to filter a few thousand
-- leavers, and joined revenue without an index, spilling a 28MB sort to disk.
-- 11.2s at the 25 months this defaulted to. 153 rewrites it and adds the index.
-- Apply 152 then 153; 153 replaces the function body outright.
