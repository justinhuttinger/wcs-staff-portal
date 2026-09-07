-- 197: membership broken out by category, for the snapshot reports.
--
-- WHY THIS RATHER THAN THE FILTER
--
-- Club Snapshot and Daily Snapshot were the last two reports on the list for
-- the Insurance / Temp / Dues filter, and they are the wrong shape for it. Only
-- 7 of Club Snapshot's ~24 metrics and 3 of Daily Snapshot's 15 are member
-- counts; the rest are Day Ones, VIPs, tours, PT and revenue, none of which a
-- membership category can narrow. Filtering those reports would empty most of
-- the page, which is the same "control that cannot change the answer" problem
-- as showing club-wide money beside filtered headcounts, only inverted.
--
-- So these two reports get an EXPANSION instead of a filter. A toggle adds a
-- row per category to the membership block — how many insurance members joined,
-- how many left, how many there are — and takes nothing away. Everything else
-- on the report keeps meaning exactly what it meant before.
--
-- THE DEFINITIONS ARE COPIED, NOT INVENTED
--
-- Every figure here uses the same rule as the report it sits inside, because a
-- breakdown that does not add up to the total it sits under is worse than no
-- breakdown at all:
--
--   members   the stock rule from analytics_topline_members_as_of — on the
--             books at p_end, skip list applied, conditional rule applied
--   joined    since_date in the window, and NEVER the conditional rule:
--             joining is a fact about the day it happened
--   left      status in Cancelled / Expired / Return For Collection with
--             member_status_date in the window, and DOES take the conditional
--             rule, so a member never counted cannot also be counted as a loss
--
-- UNMAPPED IS A ROW, NOT A CATEGORY
--
-- A membership type with no mapping appears as 'Unmapped' so the rows always
-- reconcile to the club total. It is not a category and is not offered as one
-- anywhere; it is the reconciliation remainder, and it disappears from the
-- report entirely once the types behind it are mapped in Admin. Measured
-- 2026-09-07 there are 4 such members across all seven clubs.

create or replace function public.analytics_membership_by_category(
  p_start   date,
  p_end     date,
  p_clubs   text[]  default null,
  p_exclude boolean default true
)
returns table (
  category   text,
  members    bigint,
  joined     bigint,
  left_count bigint,
  net        bigint
)
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  dead as (
    select * from public.analytics_members_excluded_as_of(p_end)
  ),
  mem as (
    select
      m.since_date, m.member_status, m.member_status_date,
      coalesce(mc.category, 'Unmapped') as cat,
      -- Resolved once per member here rather than re-tested in three
      -- aggregates, so the stock and the loss count cannot disagree about who
      -- the conditional rule excluded.
      (p_exclude and exists (
        select 1 from dead d
        where d.club_number = m.club_number and d.member_id = m.member_id
      )) as is_dead
    from public.abc_members m
    left join public.abc_membership_categories mc
      on lower(mc.membership_type) = lower(m.membership_type)
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (
        not p_exclude
        or lower(coalesce(m.membership_type, '')) not in (select t from skip)
      )
  )
  select
    cat,
    count(*) filter (
      where not is_dead
        and since_date <= p_end
        and not (
          member_status in ('Cancelled', 'Expired', 'Return For Collection')
          and member_status_date <= p_end
        )
    )::bigint,
    count(*) filter (where since_date between p_start and p_end)::bigint,
    count(*) filter (
      where not is_dead
        and member_status in ('Cancelled', 'Expired', 'Return For Collection')
        and member_status_date between p_start and p_end
    )::bigint,
    (
      count(*) filter (where since_date between p_start and p_end)
      - count(*) filter (
          where not is_dead
            and member_status in ('Cancelled', 'Expired', 'Return For Collection')
            and member_status_date between p_start and p_end
        )
    )::bigint
  from mem
  group by cat
  -- Biggest first, so Insurance and Dues lead and the Unmapped remainder falls
  -- to the bottom where it reads as the loose end it is.
  order by 2 desc;
$function$;

comment on function public.analytics_membership_by_category(date, date, text[], boolean) is
  'Membership stock and flow split by Insurance / Temp / Dues for the snapshot reports. Same rules as analytics_topline_members_as_of and analytics_topline_window, so the rows sum to the club total. Unmapped types appear as an Unmapped row rather than being dropped.';
