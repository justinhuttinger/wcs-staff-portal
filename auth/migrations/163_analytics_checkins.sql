-- 163_analytics_checkins.sql
--
-- Analytics > Check-ins.
--
-- TWO SOURCES, ON PURPOSE, BECAUSE ONE OF THEM IS BROKEN.
--
--   abc_member_checkin_months   VOLUME. One row per member per club per month.
--   checkins_hourly             SHAPE ONLY. Hour of day and day of week.
--
-- checkins_hourly has been losing data since May 2026. The two tables agreed to
-- within 0.4% every month through April and then split:
--
--   Jan  77,080 monthly / 77,310 hourly  100.3%
--   Apr  78,258 / 78,503                 100.3%
--   May  82,566 / 62,465                  75.7%
--   Jul  86,230 / 49,483                  57.4%
--   Aug  74,481 / 46,313                  62.2%
--
-- The consequence is not cosmetic. The old Check-ins report reads the hourly
-- table and therefore shows check-ins DOWN 43% since January. They are UP:
-- 77,080 in January against 86,230 in July. The report was describing its own
-- ingestion failure as a collapse in member visits, and every club fell by the
-- same 43% at the same time, which is the tell — six independent clubs do not
-- lose four in ten visits in the same quarter.
--
-- So volume never comes from checkins_hourly here.
--
-- SHAPE STILL DOES, because the loss is close to uniform across the day. April
-- against August, share of visits by hour, drifts at most 1.8 points (8am) and
-- under 0.5 for nearly every other hour; the 5am, 9am and 5pm peaks all hold
-- their share. That is enough to answer "when are we busy" and not enough to
-- answer "how busy", so the shape functions return SHARES and the report never
-- prints an hourly count.
--
-- THE HOUR COLUMN IS PACIFIC WEARING A UTC LABEL. ABC's checkins/summaries
-- endpoint reads checkInTimestampRange as club local time, and the backfill
-- sends UTC-formatted strings, so hour_start = '2026-05-06 05:00:00+00' means
-- 5am Pacific. Hours and weekdays are therefore extracted RAW, with no time
-- zone conversion. Converting would shift the whole report seven hours and put
-- the morning rush at 10pm.

-- Club number to slug. Inline rather than reusing analytics_club_slugs(), which
-- takes and returns arrays and cannot be joined against.
create or replace function public.analytics_checkin_clubs()
returns table (club_number text, slug text)
language sql
immutable
as $$
  select * from (values
    ('30935','salem'), ('31599','keizer'), ('7655','eugene'),
    ('31598','springfield'), ('31600','clackamas'),
    ('31601','milwaukie'), ('32073','medford')
  ) as m(club_number, slug)
$$;

-- ---------------------------------------------------------------------------
-- Volume. The trustworthy source.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_checkins_monthly(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  month date,
  slug text,
  checkins bigint,
  members_visiting bigint,
  visits_per_member numeric
)
language sql
stable
as $$
  select
    m.month,
    c.slug,
    sum(m.checkins)::bigint,
    count(distinct m.member_id)::bigint,
    -- Visits per VISITING member, not per member on file. "How often do the
    -- people who come, come" is a different question from penetration, and
    -- mixing them hides a club that is busy with few loyal members.
    round(sum(m.checkins)::numeric / nullif(count(distinct m.member_id), 0), 2)
  from public.abc_member_checkin_months m
  join public.analytics_checkin_clubs() c
    -- Eugene arrives zero-padded from some ABC feeds.
    on c.club_number = ltrim(m.club_number, '0')
  where m.month >= date_trunc('month', p_start)::date
    and m.month <= p_end
    and (p_clubs is null or c.slug = any(p_clubs))
  group by m.month, c.slug
  order by m.month, c.slug
$$;

-- ---------------------------------------------------------------------------
-- Shape. Shares only — see the header for why counts are withheld.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_checkins_by_hour(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (hour int, checkins bigint, share numeric)
language sql
stable
as $$
  with h as (
    select
      -- RAW extract. The column is Pacific under a UTC label.
      extract(hour from hr.hour_start)::int as hour,
      sum(hr.total_checkins)::bigint as checkins
    from public.checkins_hourly hr
    join public.analytics_checkin_clubs() c
      on c.club_number = ltrim(hr.club_number, '0')
    where hr.hour_start >= p_start::timestamptz
      and hr.hour_start < (p_end + 1)::timestamptz
      and (p_clubs is null or c.slug = any(p_clubs))
    group by 1
  )
  select hour, checkins,
    round(100.0 * checkins / nullif(sum(checkins) over (), 0), 2)
  from h order by hour
$$;

create or replace function public.analytics_checkins_by_dow(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (dow int, checkins bigint, share numeric)
language sql
stable
as $$
  with d as (
    select
      extract(dow from hr.hour_start)::int as dow,
      sum(hr.total_checkins)::bigint as checkins
    from public.checkins_hourly hr
    join public.analytics_checkin_clubs() c
      on c.club_number = ltrim(hr.club_number, '0')
    where hr.hour_start >= p_start::timestamptz
      and hr.hour_start < (p_end + 1)::timestamptz
      and (p_clubs is null or c.slug = any(p_clubs))
    group by 1
  )
  select dow, checkins,
    round(100.0 * checkins / nullif(sum(checkins) over (), 0), 2)
  from d order by dow
$$;

-- ---------------------------------------------------------------------------
-- How far the hourly feed has drifted from the truth, per month.
--
-- Shown ON the report rather than kept in a comment here. A reader looking at
-- an hour-of-day chart is entitled to know it was drawn from 57% of the visits,
-- and to see the month the divergence started.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_checkins_coverage(
  p_start date,
  p_end date
)
returns table (month date, monthly_total bigint, hourly_total bigint, capture numeric)
language sql
stable
as $$
  with m as (
    select month, sum(checkins)::bigint as total
    from public.abc_member_checkin_months
    where month >= date_trunc('month', p_start)::date and month <= p_end
    group by month
  ),
  h as (
    select date_trunc('month', hour_start)::date as month,
           sum(total_checkins)::bigint as total
    from public.checkins_hourly
    where hour_start >= date_trunc('month', p_start)::timestamptz
      and hour_start < (p_end + 1)::timestamptz
    group by 1
  )
  select
    coalesce(m.month, h.month),
    coalesce(m.total, 0),
    coalesce(h.total, 0),
    round(100.0 * coalesce(h.total, 0) / nullif(m.total, 0), 1)
  from m full join h on h.month = m.month
  order by 1
$$;
