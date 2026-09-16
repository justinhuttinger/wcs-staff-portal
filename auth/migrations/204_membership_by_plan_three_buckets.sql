-- Plan type down to THREE buckets: 1-Year, Month-to-Month, Paid in Full.
--
-- Replaces 202's mapping only. Cash Open (nothing drafting: insurance, comps)
-- and a missing or unrecognised term now count as Month-to-Month, matching
-- auth/src/lib/planType.js:
--
--   Installment -> one-year   Cash -> pif   everything else -> mtm
--
-- Same signature and predicates as 202, so it is a drop-in replace.

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
        when 'cash'        then 'pif'
        else 'mtm'
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
