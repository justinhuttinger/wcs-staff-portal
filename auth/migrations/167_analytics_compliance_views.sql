-- 167_analytics_compliance_views.sql
--
-- Three ways to slice Compliance, answering three different questions that the
-- club/checklist rollups in migration 164 cannot.
--
--   BY JOB     how many times did this checklist actually get done in the
--              window. Completed means done AT ALL — on_time or late. Missed is
--              the opposite. This is a count of completions, not a rate,
--              because the question is "is this getting done" rather than "how
--              well".
--
--   BY PERSON  who is participating. Distinct jobs touched and steps completed,
--              not a quality score: somebody who does 400 steps across 60 jobs
--              is carrying the club, and that is worth seeing even though it
--              says nothing about how well each was done.
--
--   BY DAY     what got done yesterday and what did not. Ordered newest first,
--              because the reason to open this view is almost always to ask
--              about a specific recent day.
--
-- 'unknown' IS EXCLUDED FROM BY PERSON, matching Problem Areas. It is a
-- placeholder Operandio writes, not a member of staff, and it would top the
-- leaderboard.
--
-- Only 55,205 of 114,424 steps carry a completed_by, so BY PERSON describes who
-- is credited rather than everything that happened. The report says so.
--
-- The not-yet-due exclusion from 164 holds here too: pending and in_progress
-- jobs are not failures and stay out of every rate.

create or replace function public.analytics_compliance_by_job(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  name text,
  slug text,
  decided bigint,
  completed bigint,
  missed bigint,
  steps_total bigint,
  steps_done bigint,
  task_pct numeric
)
language sql
stable
as $$
  select
    coalesce(nullif(btrim(j.display_name), ''), '(unnamed job)'),
    j.location_slug,
    count(*) filter (where j.compliance_status in ('on_time','late','missed'))::bigint,
    -- Done at all, on time or late.
    count(*) filter (where j.compliance_status in ('on_time','late'))::bigint,
    count(*) filter (where j.compliance_status = 'missed')::bigint,
    coalesce(sum(j.steps_total) filter (where j.compliance_status in ('on_time','late','missed')), 0)::bigint,
    coalesce(sum(j.steps_done)  filter (where j.compliance_status in ('on_time','late','missed')), 0)::bigint,
    round(100.0 * coalesce(sum(j.steps_done) filter (where j.compliance_status in ('on_time','late','missed')), 0)
      / nullif(sum(j.steps_total) filter (where j.compliance_status in ('on_time','late','missed')), 0), 1)
  from public.operandio_api_jobs j
  where j.job_date >= p_start and j.job_date <= p_end
    and (p_clubs is null or j.location_slug = any(p_clubs))
  group by 1, 2
  having count(*) filter (where j.compliance_status in ('on_time','late','missed')) > 0
  order by 4 desc, 3 desc
$$;

create or replace function public.analytics_compliance_by_person(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  person text,
  jobs_touched bigint,
  steps_done bigint,
  days_active bigint,
  clubs text
)
language sql
stable
as $$
  select
    btrim(s.completed_by),
    count(distinct s.job_id)::bigint,
    count(*)::bigint,
    count(distinct j.job_date)::bigint,
    string_agg(distinct j.location_slug, ', ' order by j.location_slug)
  from public.operandio_api_job_steps s
  join public.operandio_api_jobs j on j.id = s.job_id
  where j.job_date >= p_start and j.job_date <= p_end
    and (p_clubs is null or j.location_slug = any(p_clubs))
    and s.completed_by is not null
    and btrim(s.completed_by) <> ''
    and lower(btrim(s.completed_by)) <> 'unknown'
  group by 1
  order by 2 desc, 3 desc
$$;

create or replace function public.analytics_compliance_by_date(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  job_date date,
  decided bigint,
  completed bigint,
  missed bigint,
  not_yet_due bigint,
  steps_total bigint,
  steps_done bigint,
  task_pct numeric
)
language sql
stable
as $$
  select
    j.job_date,
    count(*) filter (where j.compliance_status in ('on_time','late','missed'))::bigint,
    count(*) filter (where j.compliance_status in ('on_time','late'))::bigint,
    count(*) filter (where j.compliance_status = 'missed')::bigint,
    count(*) filter (where j.compliance_status in ('pending','in_progress'))::bigint,
    coalesce(sum(j.steps_total) filter (where j.compliance_status in ('on_time','late','missed')), 0)::bigint,
    coalesce(sum(j.steps_done)  filter (where j.compliance_status in ('on_time','late','missed')), 0)::bigint,
    round(100.0 * coalesce(sum(j.steps_done) filter (where j.compliance_status in ('on_time','late','missed')), 0)
      / nullif(sum(j.steps_total) filter (where j.compliance_status in ('on_time','late','missed')), 0), 1)
  from public.operandio_api_jobs j
  where j.job_date >= p_start and j.job_date <= p_end
    and (p_clubs is null or j.location_slug = any(p_clubs))
  group by 1
  -- Newest first: the reason to open this view is nearly always a recent day.
  order by 1 desc
$$;
