-- Denormalize per-job step counts onto operandio_api_jobs.
--
-- Compliance is scored task-level (tasks done / tasks on jobs that came due) as
-- of 2026-07-15. Reports roll up from job rows, so without these columns every
-- rollup would have to join operandio_api_job_steps (~80k rows and growing) and
-- ship a row per step to the browser.
--
-- percent_complete already carries Operandio's own per-job figure, but it's a
-- truncated percentage — it can't be re-weighted across jobs, which is what a
-- task-level rate over a date range needs. Hence raw counts.

alter table operandio_api_jobs
  add column if not exists steps_total int,
  add column if not exists steps_done  int;

comment on column operandio_api_jobs.steps_total is
  'Count of step rows for this job. Mirrored by operandioSync; see migration 090.';
comment on column operandio_api_jobs.steps_done is
  'Count of step rows with completed_at set (skipped steps carry completed_at, so they count as done — same as job-level, where a skip scores on_time).';

-- Backfill from the step detail already synced (Jan 2026 onward).
update operandio_api_jobs j
set steps_total = c.total,
    steps_done  = c.done
from (
  select job_id,
         count(*)::int                                          as total,
         count(*) filter (where completed_at is not null)::int  as done
  from operandio_api_job_steps
  group by job_id
) c
where c.job_id = j.id
  and (j.steps_total is distinct from c.total
       or j.steps_done is distinct from c.done);
