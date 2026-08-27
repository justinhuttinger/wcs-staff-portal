-- 138: Dues vs Discretionary classification, and Revenue Trends.
--
-- Dues vs Discretionary is a second, independent cut of the same profit
-- centres, so it is a column rather than another table. A centre can sit in the
-- Other *group* (too small to earn its own bar) while still being Dues & Fees:
-- enrolment, service and late fees are exactly that, which is why the inserts
-- below carry group_name 'Other' and revenue_class 'Dues & Fees'.
alter table public.abc_profit_center_groups
  add column if not exists revenue_class text not null default 'Discretionary';

update public.abc_profit_center_groups
   set revenue_class = 'Dues & Fees'
 where group_name in ('Dues', 'Annual Fee');

insert into public.abc_profit_center_groups (profit_center, group_name, sort_order, revenue_class) values
  ('ENROLLMENT FEE',                'Other', 999, 'Dues & Fees'),
  ('SERVICE FEE',                   'Other', 999, 'Dues & Fees'),
  ('LATE FEE',                      'Other', 999, 'Dues & Fees'),
  ('ABC LATE-SERVICE FEES',         'Other', 999, 'Dues & Fees'),
  ('CCPROCFEE',                     'Other', 999, 'Dues & Fees'),
  ('CCCONVFEE2',                    'Other', 999, 'Dues & Fees'),
  ('FREEZEFEE',                     'Other', 999, 'Dues & Fees'),
  ('CANCEL FEE',                    'Other', 999, 'Dues & Fees'),
  ('CANCELLATION FEE',              'Other', 999, 'Dues & Fees'),
  ('STANDARD STATEMENT PROCESSING', 'Other', 999, 'Dues & Fees'),
  ('ADDFAM1',                       'Other', 999, 'Dues & Fees'),
  ('ADDFAM2',                       'Other', 999, 'Dues & Fees'),
  ('ADDFAM3',                       'Other', 999, 'Dues & Fees'),
  ('CORPORATE',                     'Other', 999, 'Dues & Fees')
on conflict (profit_center) do update
  set revenue_class = excluded.revenue_class;

-- Revenue Trends: the same revenue at three grains, split by one segment.
--
-- One call returns all three because the report shows them stacked and a reader
-- compares across them; three round trips would let the panels disagree if data
-- landed between calls.
--
-- DAILY IS CAPPED. Four years of daily buckets times a dozen segment values is
-- tens of thousands of points that no screen can draw and no reader can use.
-- The annual and monthly panels carry the long view; daily carries the recent
-- window, and the report states which window it is drawing rather than quietly
-- truncating.
--
-- Verified: 2026 YTD splits $4,465,097 Dues & Fees against $2,148,440
-- Discretionary.
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
  select 'annual'::text, date_trunc('year', payment_date)::date, seg_value, sum(amount)
  from resolved group by 2, 3
  union all
  select 'monthly'::text, date_trunc('month', payment_date)::date, seg_value, sum(amount)
  from resolved group by 2, 3
  union all
  select 'daily'::text, payment_date, seg_value, sum(amount)
  from resolved
  where payment_date > (p_end - p_daily_days)
  group by 2, 3
  order by 1, 2, 4 desc;
$function$;
