-- Windows behind Analytics > Topline.
--
-- Topline compares periods that are NOT month-aligned (month-to-date through a
-- given day, trailing 30 days, trailing 3 months), which is why it cannot reuse
-- analytics_club_activity's monthly series.
--
-- Two functions:
--   analytics_topline_window()     metrics for one arbitrary date window
--   analytics_topline()            calls it once per named window, returns jsonb
--
-- Definitions match the rest of the Analytics tab:
--   * new members counted on since_date, the ORIGINAL join date, never
--     sign_date — sign_date moves when a member re-signs and silently drains
--     older periods, which inverts year-over-year comparisons. See migration
--     124's note.
--   * lost = Cancelled / Expired / Return For Collection, dated by
--     member_status_date.
--   * the abc_membership_skip_list gates member counts, matching Salesperson
--     Performance. Revenue and check-ins carry no membership type so it cannot
--     apply to them.
--   * check-ins report has_checkin_data = false for windows that start before
--     collection began, so the API can send null instead of a zero that would
--     read as "nobody came in".

create or replace function public.analytics_topline_window(
  p_start   date,
  p_end     date,
  p_clubs   text[]  default null,
  p_exclude boolean default true
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
  )
  select
    (select count(*) from mem where since_date between p_start and p_end),
    (select count(*) from mem
      where member_status in ('Cancelled', 'Expired', 'Return For Collection')
        and member_status_date between p_start and p_end),
    (select coalesce(sum(next_due_amount), 0) from mem where since_date between p_start and p_end),
    (select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
      where r.payment_date between p_start and p_end
        and (p_clubs is null or r.club_number = any(p_clubs))),
    (select coalesce(sum(r.payment_amount), 0) from public.abc_revenue_transactions r
      where r.payment_date between p_start and p_end
        and r.profit_center = 'TRAINING'
        and (p_clubs is null or r.club_number = any(p_clubs))),
    (select coalesce(sum(c.total_checkins), 0) from public.checkins_hourly c
      where c.hour_start >= p_start
        and c.hour_start < (p_end + 1)
        and (p_clubs is null or c.club_number = any(p_clubs))),
    -- The window must start at or after collection began, otherwise its total
    -- is a partial window masquerading as a whole one.
    (p_start >= (select min(hour_start)::date from public.checkins_hourly));
$$;

-- Members on the books at a given date: joined by then, and not already lost by
-- then. abc_members keeps only the LATEST status change, so a member who
-- cancelled, rejoined and cancelled again is judged on their single surviving
-- status row.
create or replace function public.analytics_topline_members_as_of(
  p_at      date,
  p_clubs   text[]  default null,
  p_exclude boolean default true
)
returns bigint
language sql
stable
as $$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  )
  select count(*)
  from public.abc_members m
  where (p_clubs is null or m.club_number = any(p_clubs))
    and (
      not p_exclude
      or lower(coalesce(m.membership_type, '')) not in (select t from skip)
    )
    and m.since_date <= p_at
    and not (
      m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
      and m.member_status_date <= p_at
    );
$$;

create or replace function public.analytics_topline(
  p_end     date,
  p_clubs   text[]  default null,
  p_exclude boolean default true
)
returns jsonb
language sql
stable
as $$
  with w(name, s, e) as (
    values
      -- Month to date, and the two periods it is judged against. Both partners
      -- stop at the same DAY OF MONTH, so a comparison is never a full month
      -- against a partial one.
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
  )
  select jsonb_build_object(
    'windows', (
      select jsonb_object_agg(
        w.name,
        to_jsonb(m) || jsonb_build_object('start', w.s, 'end', w.e)
      )
      from w, lateral public.analytics_topline_window(w.s, w.e, p_clubs, p_exclude) m
    ),
    'members', jsonb_build_object(
      'now',            public.analytics_topline_members_as_of(p_end, p_clubs, p_exclude),
      'prior_year',     public.analytics_topline_members_as_of((p_end - interval '1 year')::date, p_clubs, p_exclude),
      'start_of_year',  public.analytics_topline_members_as_of((date_trunc('year', p_end)::date - 1), p_clubs, p_exclude),
      'start_of_py',    public.analytics_topline_members_as_of((date_trunc('year', p_end - interval '1 year')::date - 1), p_clubs, p_exclude),
      -- Denominator for the prior three-month revenue-per-member window.
      'prior3mo_end',   public.analytics_topline_members_as_of((p_end - interval '3 months')::date, p_clubs, p_exclude)
    ),
    'as_of', p_end
  );
$$;

comment on function public.analytics_topline is
  'Window metrics for Analytics > Topline. New members count since_date (original join), never sign_date.';
