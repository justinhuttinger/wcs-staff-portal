-- 154_analytics_member_journey.sql
--
-- Analytics > Member Journey. What a member is worth, and how often they come,
-- by MONTH OF MEMBERSHIP rather than by calendar month. Everybody's first month
-- is 0, so a member who joined last week sits beside one who joined two years
-- ago at the same point in their own membership.
--
-- THE DENOMINATOR IS THE POINT OF THIS FUNCTION.
--
-- abc_member_checkin_months holds NO ZERO ROWS -- 250,871 rows, every one of
-- them a month somebody actually visited. Averaging that table directly answers
-- "among members who came, how often did they come", which produces a flat line
-- at about 7.9 visits and hides the thing the report exists to show. Generating
-- one row per member per month they were a member, then left-joining check-ins,
-- turns it into "how often does the average member come" -- which peaks at 5.8
-- in month 1 and decays to about 3.6 by month 11.
--
-- A leaver stops contributing member-months the month they leave. Without that
-- the denominator would keep counting them for ever and every curve would decay
-- toward zero for a reason that is arithmetic rather than behaviour.
--
-- WHAT IS DELIBERATELY ABSENT: Avg Duration. The source tool pairs check-ins
-- with it on a second y-axis. Nothing in our data records how long a visit
-- lasted; abc_calendar_events.duration_minutes is the length of a booked
-- APPOINTMENT and exists only for members who booked one, so using it would
-- answer a different question about a different population.
--
-- Revenue is joined on club + agreement number, the same key Attrition Trends
-- uses, and on a payment_date RANGE rather than date_trunc(payment_date) =
-- month: the truncation made idx_revenue_member_key unusable and the planner
-- seq-scanned all 541k revenue rows, spilling a 31MB sort to disk. That one
-- change took this from 6,792 ms to 2,037 ms.

create or replace function public.analytics_member_journey(
  p_join_from date,
  p_join_to date,
  p_clubs text[] default null,
  p_max_months integer default 24,
  p_status text default 'all',
  p_gender text default null,
  p_age_group text default null,
  p_join_source text default null,
  p_membership_type text default null,
  p_pt text default 'all',
  p_exclude boolean default true
)
returns table (
  tenure_month integer,
  member_months bigint,
  members bigint,
  avg_checkins numeric,
  avg_spend numeric,
  group_name text,
  group_spend numeric
)
language sql
stable
as $$
  with skip as (select lower(membership_type) as t from public.abc_membership_skip_list),
  cohort as (
    select
      m.club_number, m.member_id, m.agreement_number,
      date_trunc('month', m.since_date)::date as join_month,
      -- The last month this member was still a member. See the header: without
      -- this the denominator keeps counting leavers for ever.
      least(
        date_trunc('month', coalesce(
          case when m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
               then m.member_status_date end,
          current_date))::date,
        date_trunc('month', current_date)::date
      ) as end_month
    from public.abc_members m
    left join public.abc_member_segments s
      on s.club_number = m.club_number and s.member_id = m.member_id
    where m.since_date is not null
      and m.since_date >= p_join_from
      and m.since_date <= p_join_to
      and (p_clubs is null or m.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(m.membership_type, '')) not in (select t from skip))
      and (p_status = 'all'
           or (p_status = 'active' and m.member_status not in ('Cancelled', 'Expired', 'Return For Collection'))
           or (p_status = 'left' and m.member_status in ('Cancelled', 'Expired', 'Return For Collection')))
      and (p_gender is null or coalesce(s.seg_gender, 'Unknown') = p_gender)
      and (p_age_group is null or coalesce(s.seg_age_group, 'Unknown') = p_age_group)
      and (p_join_source is null or coalesce(s.seg_join_source, 'Unknown') = p_join_source)
      and (p_membership_type is null or coalesce(s.seg_membership_type, 'Unknown') = p_membership_type)
      and (p_pt = 'all' or (p_pt = 'yes') = exists (
            select 1 from public.abc_pt_services ps
            where ps.club_number = m.club_number and ps.member_id = m.member_id
              and ps.inactive_date is null
          ))
  ),
  -- One row per member per month they were a member. THE DENOMINATOR.
  bounded as (
    select c.club_number, c.member_id, c.agreement_number, g.m as month,
           ((extract(year from age(g.m, c.join_month)) * 12
             + extract(month from age(g.m, c.join_month))))::int as tenure
    from cohort c
    cross join lateral generate_series(
      c.join_month,
      least(c.end_month, (c.join_month + ((p_max_months) || ' months')::interval)::date),
      '1 month'
    ) g(m)
    where c.end_month >= c.join_month
  ),
  visits as (
    select b.tenure,
           count(*) as member_months,
           count(distinct b.member_id) as members,
           avg(coalesce(k.checkins, 0))::numeric as avg_checkins
    from bounded b
    left join public.abc_member_checkin_months k
      on k.club_number = b.club_number and k.member_id = b.member_id and k.month = b.month
    group by b.tenure
  ),
  spend as (
    select b.tenure,
           coalesce(g.group_name, 'Other') as grp,
           sum(t.payment_amount) as total
    from bounded b
    join public.abc_revenue_transactions t
      on ltrim(t.club_number, '0') = ltrim(b.club_number, '0')
     and lpad(t.member_number, 5, '0') = lpad(b.agreement_number, 5, '0')
     -- A RANGE, not date_trunc(payment_date) = month. See the header.
     and t.payment_date >= b.month
     and t.payment_date < (b.month + interval '1 month')
    left join public.abc_profit_center_groups g on g.profit_center = t.profit_center
    group by b.tenure, coalesce(g.group_name, 'Other')
  ),
  -- Pulled out of a correlated subquery that ran once per output row.
  spend_total as (
    select tenure, sum(total) as total from spend group by tenure
  )
  select
    v.tenure,
    v.member_months,
    v.members,
    round(v.avg_checkins, 2),
    round(coalesce(st.total, 0) / nullif(v.member_months, 0), 2),
    s.grp,
    round(coalesce(s.total, 0) / nullif(v.member_months, 0), 2)
  -- LEFT joined: a tenure month where nobody bought anything still returns its
  -- check-in row, so the visit curve never develops a hole.
  from visits v
  left join spend_total st on st.tenure = v.tenure
  left join spend s on s.tenure = v.tenure
  order by v.tenure, s.grp
$$;
