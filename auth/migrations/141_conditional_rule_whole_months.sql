-- 141: anchor the conditional membership rule to WHOLE MONTHS.
--
-- THE RULE, restated
--
--   An A2 CORE or Active and Fit Limited member counts in a month if they
--   checked in that month or the month before. Members who joined inside that
--   window count regardless, since they have not had the full window to visit.
--
-- WHY IT CHANGED
--
-- The rule was "checked in within 60 days". Check-ins are only stored per
-- MONTH, so answering that needed date_trunc(as_of - 60) -- and that lands on a
-- different month depending on where in the month you ask:
--
--   as of 26 Aug -> window opens 1 June  (87 days)
--   as of 31 Aug -> window opens 1 July  (62 days)
--
-- The same members, five days apart, gave 3,538 and 3,586 exclusions. That is
-- why Topline and the trend reports could never agree: they anchor on different
-- dates. Whole months give the same answer on every day of the month.
--
-- The threshold moves to active_within_months (2), because a rule evaluated in
-- months should be stated in months. active_within_days is left in place for
-- reference and is no longer read.
--
-- EFFECT: 48 more conditional members excluded (3,538 -> 3,586 today), which is
-- exactly the drift being removed -- the new answer equals what the old rule
-- gave at month end, the stricter and more defensible of the two readings.
--
-- VERIFIED after applying, all as of 2026-08-01:
--   Club Activity     17,037
--   Membership Trends 17,037
--   Revenue Per Member 17,037
--   PT Penetration    17,037
--   Topline (26th)    17,037
--   Topline (31st)    17,037   <- previously 17,077 on the 26th
--
-- Membership Mix reads 17,042. That is FRESHNESS, not definition: it uses
-- abc_members.last_check_in_timestamp, which is day-accurate and synced
-- continuously, while the others read abc_member_checkin_months. Those 5 are
-- members who visited since the table was last refreshed. Kept deliberately --
-- the fresher answer is the more accurate one, and the nightly refresh added in
-- this change keeps the gap under a day.

alter table public.abc_conditional_membership_types
  add column if not exists active_within_months integer not null default 2;

update public.abc_conditional_membership_types
   set active_within_months = 2
 where active_within_months is distinct from 2;

comment on column public.abc_conditional_membership_types.active_within_months is
  'How many whole months the check-in window spans, inclusive of the month being evaluated. 2 means "this month or last month".';

create or replace function public.analytics_conditional_window_start(
  p_month  date,
  p_months integer default 2
)
returns date
language sql
immutable
as $$
  select (date_trunc('month', p_month) - ((greatest(p_months, 1) - 1) || ' months')::interval)::date;
$$;

comment on function public.analytics_conditional_window_start is
  'First month of the conditional membership check-in window. Whole months, so the rule does not drift with the day it is asked on.';

create or replace function public.analytics_members_excluded_as_of(p_asof date)
returns table (club_number text, member_id text)
language sql
stable
as $$
  select m.club_number, m.member_id
  from public.abc_members m
  join public.abc_conditional_membership_types c
    on c.membership_type = m.membership_type
  cross join lateral (
    select public.analytics_conditional_window_start(p_asof, c.active_within_months) as w
  ) win
  where
    -- NEW-MEMBER WAIVER, on the same footing as the check-in test: a member who
    -- joined inside the window has not had the full window to visit.
    not (m.since_date is not null and m.since_date >= win.w)
    and not exists (
      select 1
      from public.abc_member_checkin_months k
      where k.club_number = m.club_number
        and k.member_id = m.member_id
        and k.checkins > 0
        and k.month >= win.w
        and k.month <= date_trunc('month', p_asof)::date
    );
$$;

comment on function public.analytics_members_excluded_as_of is
  'A2 CORE and Active and Fit Limited members NOT counted as of p_asof: no check-in in the last two whole months, and not joined within them. Whole months, so the answer does not change with the day of the month.';

-- Membership Mix reads this view. It keeps abc_members.last_check_in_timestamp
-- rather than the monthly table, so it takes on no staleness dependency; only
-- the WINDOW changes, to whole months. It also gains the new-member waiver,
-- which the point-in-time version had and this one was missing.
create or replace view public.abc_members_counted as
select
  m.*,
  c.membership_type is not null as is_conditional_type,
  case
    when c.membership_type is null then true
    when m.since_date is not null
         and m.since_date >= public.analytics_conditional_window_start(current_date, c.active_within_months)
      then true
    when m.last_check_in_timestamp is null then false
    -- A timestamp we cannot parse is NOT a visit. Left to NULL semantics these
    -- rows fall out of both sides and vanish from the totals entirely.
    when m.last_check_in_timestamp !~ '^\d{4}-\d{2}-\d{2}' then false
    when left(m.last_check_in_timestamp, 10)::date
         >= public.analytics_conditional_window_start(current_date, c.active_within_months)
      then true
    else false
  end as counts_as_member
from public.abc_members m
left join public.abc_conditional_membership_types c
  on c.membership_type = m.membership_type;

-- The four reports that inline the rule follow. Each replaces the old
-- pre-aggregated `live` CTE with a per-member EXISTS against the window, so a
-- membership type with a different threshold stays correct rather than
-- borrowing the widest one. The EXISTS rides the unique index on
-- (club_number, member_id, month).
--
-- Their series also start one month EARLIER than before: a two-month window
-- needs only one prior month of history, where the old 60-day form needed two.

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
  select
    coalesce(stock.mo, joined.mo)   as month_start,
    coalesce(stock.seg, joined.seg) as segment,
    coalesce(stock.n, 0)            as total_members,
    coalesce(joined.n, 0)           as new_members
  from stock
  full outer join joined on joined.mo = stock.mo and joined.seg = stock.seg
  order by 1, 2;
$function$;

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
  clubs as (select distinct club_number from mem),
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
  svc as (
    select s.*,
           (s.recurring_type_desc ilike '%paid in full%') as is_pif,
           case
             when s.invoice_total > 0 and s.unit_price > 0 then
               least(greatest(ceil(round(s.invoice_total / s.unit_price) / 5.3), 1), 12)::int
             else p_pif_months
           end as pif_months
    from public.abc_pt_services s
    where (p_clubs is null or s.club_number = any(p_clubs))
      and s.sale_date is not null
  ),
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
       (svc.is_pif and svc.sale_date >= (months.mo - ((svc.pif_months - 1) || ' months')::interval))
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
