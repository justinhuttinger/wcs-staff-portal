-- 139: First Purchases by Join Month -- how long after joining a member first
-- buys personal training.
--
-- The cohort is members who JOINED inside the window (since_date), not members
-- who bought inside it. That is the question being asked -- of the people we
-- signed, how many go on to buy training, and how soon -- so the denominator
-- has to be the intake, not the buyers.
--
-- SOURCE LIMITATION, stated rather than buried. abc_pt_services is ABC's
-- current recurring-services list, so it holds services that still exist on the
-- account: 1,196 members back to June 2022. A package bought and long since
-- purged is not in it, which biases the older tenure buckets downward.
--
-- TRAINING revenue transactions reach further back, but they key on the
-- AGREEMENT number rather than a member id, so on a family agreement they
-- cannot say WHO bought -- which is the whole question here. That is the same
-- trap that made PT Penetration v1 wrong (migration 133).
--
-- Tenure runs from since_date to the first sale on file. NEGATIVE tenure is
-- possible and is bucketed as Month 1: since_date moves on a re-sign, so a
-- long-standing member who re-signed can show a purchase before their current
-- since_date. Dropping those rows would quietly shrink the purchaser count.
--
-- Verified over joins since 2018: 45,077 members, 996 buyers (2.2%), split
-- Month 1 44.9%, Months 2-6 21.3%, Months 7-12 12.7%, Year 2 9.6%, Year 3 3.6%,
-- Year 4+ 7.9%.
create or replace function public.analytics_first_pt_purchase(
  p_join_from date,
  p_join_to   date,
  p_clubs     text[] default null,
  p_segment   text   default 'club',
  p_exclude   boolean default true
)
returns table (
  segment            text,
  bucket             text,
  bucket_order       integer,
  purchasers         bigint,
  segment_members    bigint,
  segment_purchasers bigint
)
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  cohort as (
    select
      s.club_number, s.member_id, s.since_date,
      case p_segment
        when 'membership_type' then s.seg_membership_type
        when 'gender'          then s.seg_gender
        when 'age_group'       then s.seg_age_group
        when 'generation'      then s.seg_generation
        when 'payment_term'    then s.seg_payment_term
        when 'join_source'     then s.seg_join_source
        when 'salesperson'     then s.seg_salesperson
        else s.club_number
      end as seg
    from public.abc_member_segments s
    where (p_clubs is null or s.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(s.membership_type, '')) not in (select t from skip))
      and s.since_date between p_join_from and p_join_to
  ),
  first_buy as (
    select club_number, member_id, min(sale_date) as first_sale
    from public.abc_pt_services
    where sale_date is not null
    group by 1, 2
  ),
  tenured as (
    select
      c.seg, c.member_id, c.club_number, f.first_sale,
      case when f.first_sale is null then null else (f.first_sale - c.since_date) end as days
    from cohort c
    left join first_buy f
      on f.club_number = c.club_number and f.member_id = c.member_id
  ),
  bucketed as (
    select
      seg,
      case
        when days is null then null
        when days < 31   then 'Month 1'
        when days < 183  then 'Months 2-6'
        when days < 366  then 'Months 7-12'
        when days < 731  then 'Year 2'
        when days < 1096 then 'Year 3'
        else 'Year 4+'
      end as bucket
    from tenured
  ),
  totals as (
    select seg,
           count(*) as members,
           count(*) filter (where bucket is not null) as buyers
    from bucketed group by 1
  ),
  -- Every bucket for every segment, so a bucket nobody landed in is a visible
  -- zero rather than a gap that shifts the remaining bars along the axis.
  grid as (
    select t.seg, b.bucket, b.bucket_order
    from totals t
    cross join (values
      ('Month 1', 1), ('Months 2-6', 2), ('Months 7-12', 3),
      ('Year 2', 4), ('Year 3', 5), ('Year 4+', 6)
    ) as b(bucket, bucket_order)
  )
  select
    grid.seg           as segment,
    grid.bucket,
    grid.bucket_order,
    coalesce(c.n, 0)   as purchasers,
    totals.members     as segment_members,
    totals.buyers      as segment_purchasers
  from grid
  join totals on totals.seg = grid.seg
  left join (
    select seg, bucket, count(*) as n
    from bucketed where bucket is not null group by 1, 2
  ) c on c.seg = grid.seg and c.bucket = grid.bucket
  order by grid.seg, grid.bucket_order;
$function$;
