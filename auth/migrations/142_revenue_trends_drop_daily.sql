-- 142: Revenue Trends drops the daily grain. Annual and monthly only.
--
-- Daily was the largest part of the payload by far -- 180 buckets against 32
-- monthly and 3 annual, multiplied by every series -- and it answered a
-- question nobody was asking of this report. Removed server-side rather than
-- hidden client-side, so the rows are never fetched.
--
-- p_daily_days stays in the signature so existing callers do not break. It is
-- ignored.

create or replace function public.analytics_revenue_trends(
  p_start      date,
  p_end        date,
  p_clubs      text[] default null,
  p_segment    text   default 'overall',
  p_daily_days integer default 180
)
returns table (grain text, bucket date, segment text, revenue numeric)
language sql
stable
as $function$
  with tx as (
    select
      r.payment_date, r.club_number, r.payment_amount, r.payment_type,
      r.catalog_item, r.profit_center,
      ltrim(r.club_number, '0')   as club_key,
      ltrim(r.member_number, '0') as agr_key,
      coalesce(g.group_name, 'Other')            as grp,
      coalesce(g.revenue_class, 'Discretionary') as cls
    from public.abc_revenue_transactions r
    left join public.abc_profit_center_groups g
      on g.profit_center = r.profit_center
    where r.payment_date between p_start and p_end
      and (p_clubs is null or r.club_number = any(p_clubs))
  ),
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
  select 'annual'::text, date_trunc('year', payment_date)::date, seg_value, sum(amount)
  from resolved group by 2, 3
  union all
  select 'monthly'::text, date_trunc('month', payment_date)::date, seg_value, sum(amount)
  from resolved group by 2, 3
  order by 1, 2, 4 desc;
$function$;
