-- 136: Net Membership — new in, lost out, and the net, per segment, with the
-- same window a year earlier alongside.
--
-- STOCK vs FLOW, again (see migration 132):
--   * NEW members never take the conditional membership rule. Joining is a fact
--     about the day it happened.
--   * LOST members do. A member who was never counted cannot also be counted as
--     a loss, or the net is measured against a base that never contained them —
--     and a report whose whole point is the net has to have both sides on the
--     same footing.
--
-- The rule is evaluated once, as of the window end, rather than per month:
-- this report has a single window, so analytics_members_excluded_as_of can be
-- called directly instead of being expanded set-based.
create or replace function public.analytics_net_membership(
  p_start   date,
  p_end     date,
  p_clubs   text[]  default null,
  p_segment text    default 'club',
  p_exclude boolean default true
)
returns table (
  segment      text,
  new_members  bigint,
  lost_members bigint,
  prior_new    bigint,
  prior_lost   bigint
)
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  bounds as (
    select
      p_start                                    as s,
      p_end                                      as e,
      (p_start - interval '1 year')::date        as ps,
      (p_end   - interval '1 year')::date        as pe
  ),
  mem as (
    select
      s.club_number, s.member_id, s.since_date, s.member_status, s.member_status_date,
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
  -- Two separate as-of evaluations: a member who is dead now may well have been
  -- live a year ago, and grading last year's losses by this year's liveness
  -- would rewrite history.
  dead_now as (
    select * from public.analytics_members_excluded_as_of(p_end)
  ),
  dead_prior as (
    select * from public.analytics_members_excluded_as_of((p_end - interval '1 year')::date)
  ),
  lost as (
    select m.seg, count(*) as n
    from mem m, bounds b
    left join dead_now d
      on p_exclude and d.club_number = m.club_number and d.member_id = m.member_id
    where m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
      and m.member_status_date between b.s and b.e
      and d.member_id is null
    group by 1
  ),
  lost_prior as (
    select m.seg, count(*) as n
    from mem m, bounds b
    left join dead_prior d
      on p_exclude and d.club_number = m.club_number and d.member_id = m.member_id
    where m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
      and m.member_status_date between b.ps and b.pe
      and d.member_id is null
    group by 1
  ),
  gained as (
    select m.seg, count(*) as n
    from mem m, bounds b
    where m.since_date between b.s and b.e
    group by 1
  ),
  gained_prior as (
    select m.seg, count(*) as n
    from mem m, bounds b
    where m.since_date between b.ps and b.pe
    group by 1
  ),
  -- Every segment that appears in ANY of the four counts, so a segment that
  -- only lost members this year is still a row rather than a silent omission.
  segs as (
    select seg from gained
    union select seg from lost
    union select seg from gained_prior
    union select seg from lost_prior
  )
  select
    segs.seg                          as segment,
    coalesce(gained.n, 0)             as new_members,
    coalesce(lost.n, 0)               as lost_members,
    coalesce(gained_prior.n, 0)       as prior_new,
    coalesce(lost_prior.n, 0)         as prior_lost
  from segs
  left join gained       on gained.seg = segs.seg
  left join lost         on lost.seg = segs.seg
  left join gained_prior on gained_prior.seg = segs.seg
  left join lost_prior   on lost_prior.seg = segs.seg
  order by (coalesce(gained.n, 0) - coalesce(lost.n, 0)) desc;
$function$;
