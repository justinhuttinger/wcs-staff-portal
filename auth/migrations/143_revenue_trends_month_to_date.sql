-- 143: Revenue Trends is DAILY and MONTHLY, and monthly compares like for like.
--
-- Migration 142 dropped the wrong grain. This restores daily and removes annual
-- instead.
--
-- THE MONTHLY GRAIN IS NOW MONTH-TO-DATE COMPARABLE.
--
-- Whole calendar months cannot be set against a month still running: on the
-- 26th, August holds 26 days of revenue and July holds 31, so August always
-- reads as a collapse that has not happened. And because the default range IS
-- the current month, the monthly panel had exactly one bucket and nothing to
-- trend against at all.
--
-- Each month is now cut at the SAME DAY OF THE MONTH as the range end. Asking
-- on 26 August gives Aug 1-26, Jul 1-26, Jun 1-26 and so on, so every point
-- covers the same number of days and the line means something:
--
--   Aug 1-26  $739,952      (July's WHOLE month was $904,228, so the
--   Jul 1-26  $746,160       truncation is doing real work)
--   Jun 1-26  $809,265
--   ...
--   Aug 1-26  $599,974      a year earlier
--
-- WHEN THE RANGE ALREADY ENDS ON A MONTH END, nothing is truncated — a
-- whole-month selection compares whole months. Verified: 1-31 July returns
-- $904,228, the full month. Months shorter than the cut-off are simply whole,
-- so a 31st cut-off takes all of February.
--
-- The monthly series also reaches back at least p_monthly_months regardless of
-- the selected start, because the point of a trend is the months BEFORE the one
-- you picked. A wider selection widens it further; it is a floor, not a cap.
create or replace function public.analytics_revenue_trends(
  p_start           date,
  p_end             date,
  p_clubs           text[] default null,
  p_segment         text   default 'overall',
  p_daily_days      integer default 180,
  p_monthly_months  integer default 13
)
returns table (grain text, bucket date, segment text, revenue numeric)
language sql
stable
as $function$
  with bounds as (
    select
      case
        when p_end = (date_trunc('month', p_end) + interval '1 month - 1 day')::date then 31
        else extract(day from p_end)::int
      end as day_cut,
      least(
        date_trunc('month', p_start),
        date_trunc('month', p_end) - ((greatest(p_monthly_months, 1) - 1) || ' months')::interval
      )::date as month_floor,
      greatest(p_start, (p_end - greatest(p_daily_days, 1)))::date as daily_floor
  ),
  tx as (
    select
      r.payment_date, r.club_number, r.payment_amount, r.payment_type,
      r.catalog_item, r.profit_center,
      ltrim(r.club_number, '0')   as club_key,
      ltrim(r.member_number, '0') as agr_key,
      coalesce(g.group_name, 'Other')            as grp,
      coalesce(g.revenue_class, 'Discretionary') as cls
    from public.abc_revenue_transactions r
    cross join bounds b
    left join public.abc_profit_center_groups g
      on g.profit_center = r.profit_center
    -- Widened to the monthly floor: the trend needs months BEFORE p_start.
    where r.payment_date >= least(b.month_floor, b.daily_floor)
      and r.payment_date <= p_end
      and (p_clubs is null or r.club_number = any(p_clubs))
  ),
  -- Split across the agreement, so a family's payment is not multiplied by its
  -- size. Same rule as Revenue Per Member and Revenue by Profit Center.
  seg as (
    select
      s.club_key, s.agr_key,
      case p_segment
        when 'membership_type' then s.seg_membership_type
        when 'gender'          then s.seg_gender
        when 'age_group'       then s.seg_age_group
        when 'generation'      then s.seg_generation
        when 'join_source'     then s.seg_join_source
        when 'payment_term'    then s.seg_payment_term
      end as v,
      count(*) over (partition by s.club_key, s.agr_key) as members_on_agreement
    from public.abc_member_segments s
    where p_segment in ('membership_type','gender','age_group','generation','join_source','payment_term')
      and s.agr_key is not null and s.agr_key <> ''
  ),
  resolved as (
    select
      tx.payment_date,
      case p_segment
        when 'overall'             then 'Overall'
        when 'club'                then tx.club_number
        when 'dues_discretionary'  then tx.cls
        when 'profit_center_group' then tx.grp
        when 'profit_center'       then coalesce(nullif(trim(tx.profit_center), ''), 'Unknown')
        when 'item'                then coalesce(nullif(trim(tx.catalog_item), ''), 'Unknown')
        when 'payment_type'        then coalesce(nullif(trim(tx.payment_type), ''), 'Unknown')
        else coalesce(seg.v, 'Unattributed')
      end as seg_value,
      case
        when p_segment in ('membership_type','gender','age_group','generation','join_source','payment_term')
             and seg.v is not null
        then tx.payment_amount / seg.members_on_agreement
        else tx.payment_amount
      end as amount
    from tx
    left join seg
      on p_segment in ('membership_type','gender','age_group','generation','join_source','payment_term')
     and seg.club_key = tx.club_key
     and seg.agr_key  = tx.agr_key
  )
  select 'monthly'::text, date_trunc('month', r.payment_date)::date, r.seg_value, sum(r.amount)
  from resolved r
  cross join bounds b
  where r.payment_date >= b.month_floor
    and extract(day from r.payment_date) <= b.day_cut
  group by 2, 3
  union all
  select 'daily'::text, r.payment_date, r.seg_value, sum(r.amount)
  from resolved r
  cross join bounds b
  where r.payment_date >= b.daily_floor
  group by 2, 3
  order by 1, 2, 4 desc;
$function$;
