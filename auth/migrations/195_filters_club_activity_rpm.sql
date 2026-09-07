-- 195: category and basis filters for Club Activity Trends and Revenue Per Member.
--
-- Second batch of the two member filters introduced in migration 194. Both
-- parameters go on the END with defaults that reproduce today's behaviour
-- exactly, and both functions are DROPPED before being recreated: a defaulted
-- parameter creates an overload rather than replacing, and PostgREST would then
-- have two candidates for one rpc name and refuse the call.
--
-- BOTH BODIES ARE COPIED FROM THE LIVE DEFINITION, not from the migration that
-- last created them. Migration 136's committed text had drifted from what was
-- actually running and could not be executed (see migration 195's sibling fix
-- and PR #896); building 194 from that file cost an outage. pg_get_functiondef
-- is the source of truth for any function edited since it was first shipped.
--
-- ---------------------------------------------------------------------------
-- WHAT A FILTER CAN AND CANNOT REACH
--
-- These two reports differ in a way that matters, and the difference decides
-- how each one behaves when a filter is on.
--
-- Revenue Per Member ALREADY attributes revenue to a member, through the
-- agreement number, so restricting the member set restricts the revenue with
-- it. Its money follows the filter for free. The only change needed is to stop
-- unattributed revenue piling into the 'Unattributed / Excluded' series while
-- filtered: under Insurance, every non-insurance dollar would land there and
-- the segment would dwarf the thing being asked about.
--
-- Club Activity's revenue is a CLUB-LEVEL SUM over abc_revenue_transactions
-- with no member join at all. It cannot honour a member filter. Rather than
-- show club-wide money beside insurance-only headcounts — which is exactly the
-- "control that cannot change the answer" trap the rest of this surface is
-- careful about — the two revenue columns return NULL while a filter is
-- active, and the report hides those tiles and says why.
--
-- Check-ins CAN follow the filter, because abc_member_checkin_months carries
-- club_number and member_id. The EXISTS is written so it is only evaluated
-- when a filter is actually set, leaving the default path untouched.
-- ---------------------------------------------------------------------------

drop function if exists public.analytics_club_activity(date, integer, text[], boolean);
create function public.analytics_club_activity(
  p_end      date,
  -- 25, matching the live definition. The route always passes this explicitly,
  -- but a default changed in passing is a behaviour change nobody reviewed.
  p_months   integer default 25,
  p_clubs    text[]  default null,
  p_exclude  boolean default true,
  p_category text    default 'all',
  p_basis    text    default 'members'
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
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  -- True exactly when neither filter is set. Named once so the three places
  -- that branch on it cannot drift apart.
  unfiltered as (
    select (p_category = 'all' and p_basis <> 'agreements') as v
  ),
  mem as (
    select m.*
    from public.abc_members m
    left join public.abc_membership_categories mc
      on lower(mc.membership_type) = lower(m.membership_type)
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (
        not p_exclude
        or lower(coalesce(m.membership_type, '')) not in (select t from skip)
      )
      and (p_category = 'all' or coalesce(mc.category, 'Other') = p_category)
      and (p_basis <> 'agreements' or m.is_primary_member is true)
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
            min(k.month) + interval '1 month'
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
    select m.club_number, m.member_id, m.since_date, m.member_status,
           m.member_status_date, c.active_within_months
    from mem m
    join public.abc_conditional_membership_types c
      on c.membership_type = m.membership_type
  ),
  dead as (
    select mo.mo, mo.mo_end, c.*
    from months mo
    cross join cond c
    cross join lateral (
      select public.analytics_conditional_window_start(mo.mo, c.active_within_months) as w
    ) win
    where not (c.since_date is not null and c.since_date >= win.w)
      and not exists (
        select 1 from public.abc_member_checkin_months k
        where k.club_number = c.club_number
          and k.member_id = c.member_id
          and k.checkins > 0
          and k.month >= win.w
          and k.month <= mo.mo
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
      -- Short-circuits on the unfiltered path, so the ordinary run does no
      -- per-row lookup at all.
      and (
        (select v from unfiltered)
        or exists (
          select 1 from mem m
          where m.club_number = c.club_number and m.member_id = c.member_id
        )
      )
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
    (
      select count(*) from mem
      where since_date >= mo and since_date < mo + interval '1 month'
    ) as new_member_units,
    (
      select count(*) from mem
      where member_status in ('Cancelled', 'Expired', 'Return For Collection')
        and member_status_date >= mo
        and member_status_date < mo + interval '1 month'
    ) - (case when p_exclude then coalesce((select n from lost_adj where lost_adj.mo = months.mo), 0) else 0 end) as lost_members,
    coalesce((select total_checkins from checkins where checkins.month = mo), 0) as total_checkins,
    coalesce((select unique_members from checkins where checkins.month = mo), 0) as unique_checkins,
    -- NULL, not 0, while filtered. Zero would be a claim that no money came in;
    -- null is the truth, which is that this figure cannot answer the question
    -- being asked. The report hides the tile rather than drawing a flat line.
    case when (select v from unfiltered) then (
      select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
      where r.payment_date >= mo and r.payment_date < mo + interval '1 month'
        and (p_clubs is null or r.club_number = any(p_clubs))
    ) end as total_revenue,
    case when (select v from unfiltered) then (
      select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
      where r.payment_date >= mo and r.payment_date < mo + interval '1 month'
        and r.profit_center = 'TRAINING'
        and (p_clubs is null or r.club_number = any(p_clubs))
    ) end as pt_revenue,
    (mo >= (select first_month from checkin_floor)) as has_checkin_data
  from months
  order by mo;
$function$;

drop function if exists public.analytics_revenue_per_member(date, integer, text[], text, boolean);
create function public.analytics_revenue_per_member(
  p_end       date,
  p_months    integer default 25,
  p_clubs     text[]  default null,
  p_breakdown text    default 'membership_type',
  p_exclude   boolean default true,
  p_category  text    default 'all',
  p_basis     text    default 'members'
)
returns table (month_start date, segment text, revenue numeric, members bigint)
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  unfiltered as (
    select (p_category = 'all' and p_basis <> 'agreements') as v
  ),
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
        when 'membership_category' then s.seg_membership_category
        else s.seg_membership_type
      end as segment
    from public.abc_member_segments s
    where (p_clubs is null or s.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(s.membership_type, '')) not in (select t from skip))
      and (p_category = 'all' or s.seg_membership_category = p_category)
      and (p_basis <> 'agreements' or s.seg_relationship = 'Primary')
  ),
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
            min(k.month) + interval '1 month'
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
    select m.club_number, m.member_id, m.since_date, c.active_within_months
    from mem m
    join public.abc_conditional_membership_types c
      on c.membership_type = m.membership_type
  ),
  dead as (
    select mo.mo, c.club_number, c.member_id
    from months mo
    cross join cond c
    cross join lateral (
      select public.analytics_conditional_window_start(mo.mo, c.active_within_months) as w
    ) win
    where not (c.since_date is not null and c.since_date >= win.w)
      and not exists (
        select 1 from public.abc_member_checkin_months k
        where k.club_number = c.club_number
          and k.member_id = c.member_id
          and k.checkins > 0
          and k.month >= win.w
          and k.month <= mo.mo
      )
  ),
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
      -- While filtered, revenue that does not belong to a member in scope is
      -- DROPPED rather than pooled into 'Unattributed / Excluded'. Under
      -- Insurance every non-insurance dollar would otherwise land in that one
      -- series and tower over the thing actually being asked about.
      and ((select v from unfiltered) or m.member_id is not null)
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
