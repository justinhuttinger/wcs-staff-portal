-- 196: category and basis filters for the Topline family.
--
-- Third batch of the member filters from migration 194. Three functions move
-- together because they are one thing: analytics_topline orchestrates
-- analytics_topline_window and analytics_topline_members_as_of, and a filter
-- that reached only some of them would produce a report whose cards disagreed.
--
-- All three bodies are copied from the LIVE definition (pg_get_functiondef),
-- not from the migrations that last created them. Building 194 from a stale
-- file is what caused the outage behind PR #896.
--
-- OTHER CALLERS ARE UNAFFECTED. analytics_topline_window is also called by
-- analytics_daily_series, analytics_club_snapshot's route, attritionAnalysis
-- and the nightly membershipSnapshot job, all of them positionally with four
-- arguments. The two new parameters are appended with defaults that reproduce
-- today's behaviour exactly, so every existing call resolves unchanged. The
-- functions are DROPPED before being recreated because a defaulted parameter
-- creates an overload rather than replacing it, and PostgREST refuses an rpc
-- name with two candidates.
--
-- ---------------------------------------------------------------------------
-- WHAT THE FILTER CAN REACH, CARD BY CARD
--
-- Three of Topline's numbers are about members and follow the filter:
--
--   new_members     counted from abc_members
--   lost_members    the same, with the conditional rule
--   new_dues        sum(next_due_amount) over those new members, so it is a
--                   member-derived figure and narrows with them
--
-- Three cannot, and are returned as NULL while a filter is on rather than as a
-- club-wide number sitting beside filtered headcounts:
--
--   revenue         a club-level sum over abc_revenue_transactions, no member
--   pt_revenue      join of any kind
--   checkins        from checkins_hourly, which stores an hourly total per
--                   club and carries no member id at all
--
-- NULL rather than 0 on purpose: zero asserts that nothing happened, null says
-- the figure cannot answer the question being asked.
--
-- The check-in CARD on Topline is a different source and DOES filter. It reads
-- abc_member_checkin_months, which is per member per month, so it can be
-- narrowed. That the same word means a filterable number in one place and an
-- unfilterable one in another is exactly why this is written down.
-- ---------------------------------------------------------------------------

drop function if exists public.analytics_topline(date, text[], boolean);
drop function if exists public.analytics_topline_window(date, date, text[], boolean);
drop function if exists public.analytics_topline_members_as_of(date, text[], boolean);

create function public.analytics_topline_members_as_of(
  p_at       date,
  p_clubs    text[]  default null,
  p_exclude  boolean default true,
  p_category text    default 'all',
  p_basis    text    default 'members'
)
returns bigint
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  dead as (
    select * from public.analytics_members_excluded_as_of(p_at)
  )
  select count(*)
  from public.abc_members m
  left join public.abc_membership_categories mc
    on lower(mc.membership_type) = lower(m.membership_type)
  where (p_clubs is null or m.club_number = any(p_clubs))
    and (
      not p_exclude
      or lower(coalesce(m.membership_type, '')) not in (select t from skip)
    )
    -- The conditional rule rides the same Exclude toggle as the skip list: both
    -- answer "who do we count as a member", and splitting them into two
    -- switches would let a reader produce a fourth combination nobody means.
    and (
      not p_exclude
      or not exists (
        select 1 from dead d
        where d.club_number = m.club_number and d.member_id = m.member_id
      )
    )
    and (p_category = 'all' or coalesce(mc.category, 'Other') = p_category)
    and (p_basis <> 'agreements' or m.is_primary_member is true)
    and m.since_date <= p_at
    and not (
      m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
      and m.member_status_date <= p_at
    );
$function$;

create function public.analytics_topline_window(
  p_start    date,
  p_end      date,
  p_clubs    text[]  default null,
  p_exclude  boolean default true,
  p_category text    default 'all',
  p_basis    text    default 'members'
)
returns table (
  new_members      bigint,
  lost_members     bigint,
  new_dues         numeric,
  revenue          numeric,
  pt_revenue       numeric,
  checkins         bigint,
  has_checkin_data boolean
)
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  unfiltered as (
    select (p_category = 'all' and p_basis <> 'agreements') as v
  ),
  dead as (
    select * from public.analytics_members_excluded_as_of(p_end)
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
  -- STOCK vs FLOW.
  --
  -- New members are a flow IN and never take the conditional test: somebody
  -- joined, and that is a fact about the day they joined, not about whether
  -- they have used the place since.
  --
  -- Lost members are a flow OUT of the stock, so they DO take it. A member who
  -- was never counted cannot also be counted as a loss, or attrition is
  -- measured against a base that never contained them.
  live as (
    select m.* from mem m
    where not p_exclude
       or not exists (
         select 1 from dead d
         where d.club_number = m.club_number and d.member_id = m.member_id
       )
  )
  select
    (select count(*) from mem where since_date between p_start and p_end),
    (select count(*) from live
      where member_status in ('Cancelled', 'Expired', 'Return For Collection')
        and member_status_date between p_start and p_end),
    -- Member-derived, so it narrows with them.
    (select coalesce(sum(next_due_amount), 0) from mem where since_date between p_start and p_end),
    -- Club-level sums with no member join. NULL while filtered.
    case when (select v from unfiltered) then
      (select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
        where r.payment_date between p_start and p_end
          and (p_clubs is null or r.club_number = any(p_clubs)))
    end,
    case when (select v from unfiltered) then
      (select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
        where r.payment_date between p_start and p_end
          and r.profit_center = 'TRAINING'
          and (p_clubs is null or r.club_number = any(p_clubs)))
    end,
    -- checkins_hourly is an hourly TOTAL per club and carries no member id, so
    -- this one cannot be narrowed at all. Topline's own check-in card uses
    -- abc_member_checkin_months instead, which can.
    case when (select v from unfiltered) then
      (select coalesce(sum(c.total_checkins), 0) from public.checkins_hourly c
        where c.hour_start >= p_start
          and c.hour_start < (p_end + 1)
          and (p_clubs is null or c.club_number = any(p_clubs)))
    end,
    (p_start >= (select min(hour_start)::date from public.checkins_hourly));
$function$;

create function public.analytics_topline(
  p_end      date,
  p_clubs    text[]  default null,
  p_exclude  boolean default true,
  p_category text    default 'all',
  p_basis    text    default 'members'
)
returns jsonb
language sql
stable
as $function$
  with w(name, s, e) as (
    values
      ('mtd',           date_trunc('month', p_end)::date,                                p_end),
      ('prior_mtd',     date_trunc('month', p_end - interval '1 month')::date,            (p_end - interval '1 month')::date),
      ('py_mtd',        date_trunc('month', p_end - interval '1 year')::date,             (p_end - interval '1 year')::date),
      ('ytd',           date_trunc('year', p_end)::date,                                  p_end),
      ('py_ytd',        date_trunc('year', p_end - interval '1 year')::date,              (p_end - interval '1 year')::date),
      ('last30',        (p_end - interval '29 days')::date,                               p_end),
      ('py_last30',     (p_end - interval '1 year' - interval '29 days')::date,           (p_end - interval '1 year')::date),
      ('past3mo',       (p_end - interval '3 months' + interval '1 day')::date,           p_end),
      ('prior3mo',      (p_end - interval '6 months' + interval '1 day')::date,           (p_end - interval '3 months')::date),
      ('py_past3mo',    (p_end - interval '1 year' - interval '3 months' + interval '1 day')::date, (p_end - interval '1 year')::date)
  ),
  unfiltered as (
    select (p_category = 'all' and p_basis <> 'agreements') as v
  ),
  -- The member set the check-in card is narrowed to. Only consulted when a
  -- filter is actually set, so the ordinary run pays nothing for it.
  filt as (
    select m.club_number, m.member_id
    from public.abc_members m
    left join public.abc_membership_categories mc
      on lower(mc.membership_type) = lower(m.membership_type)
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (p_category = 'all' or coalesce(mc.category, 'Other') = p_category)
      and (p_basis <> 'agreements' or m.is_primary_member is true)
  ),
  -- Check-ins compare the last COMPLETE month against the same month a year
  -- before. They used to come from checkins_hourly over each card's own window,
  -- but that table under-records recent months by ~43%, so its "last 30 days"
  -- read 25% DOWN year on year while real traffic was up 25%. The accurate
  -- source, abc_member_checkin_months, is monthly only and cannot answer a
  -- 30-day or month-to-date window. A coarser right number beats a precise
  -- wrong one, so the card changed shape rather than the source staying wrong.
  --
  -- The CTE is NOT named `checkins`: it has a column of that name, and a bare
  -- `to_jsonb(checkins)` binds to the COLUMN, silently returning a number where
  -- the object was meant.
  ci as (
    select
      m.this_month                                                    as month,
      coalesce(sum(c.checkins) filter (where c.month = m.this_month), 0)::bigint       as checkins,
      count(distinct c.member_id) filter (where c.month = m.this_month)::bigint        as members_visited,
      coalesce(sum(c.checkins) filter (where c.month = m.prior_month), 0)::bigint      as prior_checkins,
      count(distinct c.member_id) filter (where c.month = m.prior_month)::bigint       as prior_members_visited
    from (
      select
        (date_trunc('month', p_end) - interval '1 month')::date                as this_month,
        (date_trunc('month', p_end) - interval '1 month' - interval '1 year')::date as prior_month
    ) m
    left join public.abc_member_checkin_months c
      on c.month in (m.this_month, m.prior_month)
     and (p_clubs is null or c.club_number = any(p_clubs))
     -- This source IS per member, so the card narrows with the filter.
     and (
       (select v from unfiltered)
       or exists (
         select 1 from filt f
         where f.club_number = c.club_number and f.member_id = c.member_id
       )
     )
    group by m.this_month
  )
  select jsonb_build_object(
    'windows', (
      select jsonb_object_agg(
        w.name,
        to_jsonb(m) || jsonb_build_object('start', w.s, 'end', w.e)
      )
      from w, lateral public.analytics_topline_window(w.s, w.e, p_clubs, p_exclude, p_category, p_basis) m
    ),
    'members', jsonb_build_object(
      'now',            public.analytics_topline_members_as_of(p_end, p_clubs, p_exclude, p_category, p_basis),
      'prior_year',     public.analytics_topline_members_as_of((p_end - interval '1 year')::date, p_clubs, p_exclude, p_category, p_basis),
      'start_of_year',  public.analytics_topline_members_as_of((date_trunc('year', p_end)::date - 1), p_clubs, p_exclude, p_category, p_basis),
      'start_of_py',    public.analytics_topline_members_as_of((date_trunc('year', p_end - interval '1 year')::date - 1), p_clubs, p_exclude, p_category, p_basis),
      'prior3mo_end',   public.analytics_topline_members_as_of((p_end - interval '3 months')::date, p_clubs, p_exclude, p_category, p_basis)
    ),
    'checkins', (select to_jsonb(ci) from ci),
    -- Named so the report can say which cards were withheld rather than
    -- leaving three blanks that look like a failure.
    'filtered', not (select v from unfiltered),
    'as_of', p_end
  );
$function$;
