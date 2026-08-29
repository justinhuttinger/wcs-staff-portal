-- 169_analytics_compliance_day_jobs.sql
--
-- The jobs behind a single day on Compliance > By Day.
--
-- By Day answers "what got done yesterday". The obvious next question is "which
-- ones", and it should not require leaving the report to find out — so a day row
-- expands into its jobs.
--
-- ORDERED WORST FIRST INSIDE EACH DAY: missed jobs, then the least complete.
-- The reason to open a day is to find what went wrong, and an alphabetical list
-- makes that a search rather than a glance.
--
-- Returned for the whole window in one call rather than per day on click. A
-- month is around 1,600 rows, which is cheap to fetch once and group in the
-- browser, and it means expanding a row is instant instead of a round trip that
-- can fail on its own.
--
-- The not-yet-due jobs are returned too, with their status intact, because a
-- day being expanded late in the afternoon should show what is still legitimately
-- outstanding rather than hiding it and appearing to have fewer jobs than it does.

create or replace function public.analytics_compliance_day_jobs(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  job_date date,
  slug text,
  name text,
  status text,
  steps_total bigint,
  steps_done bigint,
  pct numeric,
  due_at timestamptz
)
language sql
stable
as $$
  select
    j.job_date,
    j.location_slug,
    coalesce(nullif(btrim(j.display_name), ''), '(unnamed job)'),
    j.compliance_status,
    coalesce(j.steps_total, 0)::bigint,
    coalesce(j.steps_done, 0)::bigint,
    round(100.0 * coalesce(j.steps_done, 0) / nullif(j.steps_total, 0), 1),
    j.due_at
  from public.operandio_api_jobs j
  where j.job_date >= p_start and j.job_date <= p_end
    and (p_clubs is null or j.location_slug = any(p_clubs))
  order by j.job_date desc, j.location_slug,
    (j.compliance_status = 'missed') desc,
    round(100.0 * coalesce(j.steps_done, 0) / nullif(j.steps_total, 0), 1) asc nulls last
$$;
