-- Membership by PLAN TYPE: the by-category breakdown (analytics_membership_by_category)
-- grouped by what kind of agreement the member is on instead.
--
-- Same populations, same predicates, so the rows add up to the Members, Joined
-- and Left on Club Snapshot exactly as the category rows do. Only the grouping
-- changes, and it mirrors auth/src/lib/planType.js:
--
--   Installment -> one-year   Open -> mtm   Cash Open -> no-draft   Cash -> pif
--
-- agreement_term is the member's CURRENT term, so a count as of p_end files a
-- member under the plan they are on now.
--
-- Additive: a new function, nothing replaced.

create or replace function public.analytics_membership_by_plan(
  p_start date, p_end date, p_clubs text[] default null, p_exclude boolean default true
)
returns table(plan text, members bigint, joined bigint, left_count bigint, net bigint)
language sql
stable
as $function$
  with skip as (select lower(membership_type) as t from public.abc_membership_skip_list),
  dead as (select * from public.analytics_members_excluded_as_of(p_end)),
  mem as (
    select m.since_date, m.member_status, m.member_status_date,
      case lower(trim(coalesce(m.agreement_term, '')))
        when 'installment' then 'one-year'
        when 'open'        then 'mtm'
        when 'cash open'   then 'no-draft'
        when 'cash'        then 'pif'
        else 'unknown'
      end as plan,
      (p_exclude and exists (select 1 from dead d
        where d.club_number = m.club_number and d.member_id = m.member_id)) as is_dead
    from public.abc_members m
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(m.membership_type, '')) not in (select t from skip))
  )
  select plan,
    count(*) filter (where not is_dead and since_date <= p_end
      and not (member_status in ('Cancelled','Expired','Return For Collection')
               and member_status_date <= p_end))::bigint,
    count(*) filter (where since_date between p_start and p_end)::bigint,
    count(*) filter (where not is_dead and member_status in ('Cancelled','Expired','Return For Collection')
      and member_status_date between p_start and p_end)::bigint,
    (count(*) filter (where since_date between p_start and p_end)
     - count(*) filter (where not is_dead and member_status in ('Cancelled','Expired','Return For Collection')
         and member_status_date between p_start and p_end))::bigint
  from mem group by plan order by 2 desc;
$function$;
