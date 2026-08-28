-- 164_analytics_compliance.sql
--
-- Analytics > Compliance.
--
-- DEFINITIONS ARE CARRIED OVER FROM /compliance/summary UNCHANGED, deliberately.
-- The old report and this one will be read side by side for a while, and a
-- rebuild that quietly redefines its own headline is worse than no rebuild.
--
--   DECIDED          on_time, late or missed. A job is judged once it is done
--                    or past due.
--   NOT DECIDED      pending and in_progress. NOT YET DUE, therefore not a
--                    failure and excluded from every rate.
--   On-time rate     on_time / decided.
--   Task completion  steps_done / steps_total across DECIDED jobs only. This is
--                    the headline as of 2026-07-15.
--
-- The not-yet-due exclusion is the same rule Problem Areas needed in #740,
-- where jobs were being counted against staff hours before they opened. Both
-- places now agree: work that cannot have been done yet is not missing work.
--
-- GROUPED BY display_name, NOT process_name. There are 127 process ids since
-- June carrying 59 distinct process names but 106 display names, so
-- process_name collapses genuinely different checklists into one row.
-- process_name is also a stale snapshot taken at job creation, so a renamed
-- process reports under its old name for ever; one process id already carries
-- two names.

-- ---------------------------------------------------------------------------
-- Month by club: the trend and the club comparison.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_compliance_monthly(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  month date,
  slug text,
  jobs bigint,
  decided bigint,
  on_time bigint,
  late bigint,
  missed bigint,
  not_yet_due bigint,
  steps_total bigint,
  steps_done bigint
)
language sql
stable
as $$
  select
    date_trunc('month', j.job_date)::date,
    j.location_slug,
    count(*)::bigint,
    count(*) filter (where j.compliance_status in ('on_time','late','missed'))::bigint,
    count(*) filter (where j.compliance_status = 'on_time')::bigint,
    count(*) filter (where j.compliance_status = 'late')::bigint,
    count(*) filter (where j.compliance_status = 'missed')::bigint,
    count(*) filter (where j.compliance_status in ('pending','in_progress'))::bigint,
    -- Steps counted ONLY on decided jobs. Including a job that is not due yet
    -- would score its untouched steps as incomplete and drag every rate down by
    -- however early in the day the report was opened.
    coalesce(sum(j.steps_total) filter (where j.compliance_status in ('on_time','late','missed')), 0)::bigint,
    coalesce(sum(j.steps_done)  filter (where j.compliance_status in ('on_time','late','missed')), 0)::bigint
  from public.operandio_api_jobs j
  where j.job_date >= p_start and j.job_date <= p_end
    and (p_clubs is null or j.location_slug = any(p_clubs))
  group by 1, 2
  order by 1, 2
$$;

-- ---------------------------------------------------------------------------
-- Which checklists are actually failing, AND WHERE.
--
-- Ordered worst-first by task completion, because the question this answers is
-- "what should we fix", and a list ordered by volume answers a different one.
--
-- GROUPED BY CHECKLIST *AND CLUB*, which is not a detail. Pooled across clubs
-- the worst rows read as a company-wide collapse: "Daily Club Closing
-- Checklist, 88 of 88 missed, 2,581 steps, none done". Every one of those jobs
-- is Milwaukie. Three of its daily checklists have run for 88 consecutive days
-- and been opened essentially never (opening: 3 steps done out of 2,332).
-- Pooling would have spread one club's problem across all seven and hidden the
-- only fact worth acting on.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_compliance_by_process(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  name text,
  slug text,
  jobs bigint,
  decided bigint,
  missed bigint,
  steps_total bigint,
  steps_done bigint,
  task_pct numeric
)
language sql
stable
as $$
  select
    coalesce(nullif(btrim(j.display_name), ''), '(unnamed checklist)'),
    j.location_slug,
    count(*)::bigint,
    count(*) filter (where j.compliance_status in ('on_time','late','missed'))::bigint,
    count(*) filter (where j.compliance_status = 'missed')::bigint,
    coalesce(sum(j.steps_total) filter (where j.compliance_status in ('on_time','late','missed')), 0)::bigint,
    coalesce(sum(j.steps_done)  filter (where j.compliance_status in ('on_time','late','missed')), 0)::bigint,
    round(
      100.0 * coalesce(sum(j.steps_done) filter (where j.compliance_status in ('on_time','late','missed')), 0)
      / nullif(sum(j.steps_total) filter (where j.compliance_status in ('on_time','late','missed')), 0), 1)
  from public.operandio_api_jobs j
  where j.job_date >= p_start and j.job_date <= p_end
    and (p_clubs is null or j.location_slug = any(p_clubs))
  group by 1, 2
  -- A checklist with no decided jobs has no rate and sorts last rather than
  -- appearing as the worst offender on the strength of a null.
  having count(*) filter (where j.compliance_status in ('on_time','late','missed')) > 0
  order by 8 asc nulls last, 6 desc
$$;

-- ---------------------------------------------------------------------------
-- Day of week. Operational compliance has a weekend problem at most clubs and
-- a monthly average hides it entirely.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_compliance_by_dow(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (dow int, decided bigint, steps_total bigint, steps_done bigint, task_pct numeric)
language sql
stable
as $$
  select
    extract(dow from j.job_date)::int,
    count(*) filter (where j.compliance_status in ('on_time','late','missed'))::bigint,
    coalesce(sum(j.steps_total) filter (where j.compliance_status in ('on_time','late','missed')), 0)::bigint,
    coalesce(sum(j.steps_done)  filter (where j.compliance_status in ('on_time','late','missed')), 0)::bigint,
    round(
      100.0 * coalesce(sum(j.steps_done) filter (where j.compliance_status in ('on_time','late','missed')), 0)
      / nullif(sum(j.steps_total) filter (where j.compliance_status in ('on_time','late','missed')), 0), 1)
  from public.operandio_api_jobs j
  where j.job_date >= p_start and j.job_date <= p_end
    and (p_clubs is null or j.location_slug = any(p_clubs))
  group by 1
  order by 1
$$;
