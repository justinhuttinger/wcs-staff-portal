-- email_stats_daily: bounded period query + retention.
--
-- auth/src/routes/emailMarketing.js's GET /automations previously paged
-- through the ENTIRE email_stats_daily table with no lower bound (needed a
-- baseline snapshot that predates start_date) and diffed it in Node. The
-- table grows ~294 rows/day forever (one row per workflow campaign per
-- location per day, see ghl-sync/migrations/014_email_stats_daily.sql), so
-- that endpoint's memory usage grows unbounded with wall-clock time.
--
-- email_automation_period() replaces the Node-side scan: for each campaign
-- (location, source_id) it returns at most two rows — the latest snapshot at
-- or before p_end, and the latest snapshot strictly before p_start (tagged
-- via is_baseline) — so the result is bounded by ~2 rows per campaign
-- (~600 today) regardless of how much history has accumulated. The route
-- keeps doing the diff/rate math in JS via emailAutomationMath.js, unchanged.
--
-- p_start/p_end are nullable to match the route's existing optional query
-- params: a null p_start means "no baseline" (every campaign reports as
-- is_lifetime), a null p_end means "no upper bound".
create or replace function email_automation_period(
  p_start date default null,
  p_end   date default null,
  p_location text default null
)
returns table (
  location        text,
  source_id       text,
  name            text,
  subject         text,
  snapshot_date   date,
  sent            integer,
  accepted        integer,
  delivered       integer,
  opened          integer,
  clicked         integer,
  unsubscribed    integer,
  complained      integer,
  permanent_fail  integer,
  temporary_fail  integer,
  rejected        integer,
  failed          integer,
  replied         integer,
  is_baseline     boolean
)
language sql
stable
as $$
  select location, source_id, name, subject, snapshot_date, sent, accepted,
         delivered, opened, clicked, unsubscribed, complained, permanent_fail,
         temporary_fail, rejected, failed, replied, false as is_baseline
  from (
    select distinct on (location, source_id) *
    from email_stats_daily
    where source = 'workflow-campaigns'
      and (p_end is null or snapshot_date <= p_end)
      and (p_location is null or location = p_location)
    order by location, source_id, snapshot_date desc
  ) latest

  union all

  select location, source_id, name, subject, snapshot_date, sent, accepted,
         delivered, opened, clicked, unsubscribed, complained, permanent_fail,
         temporary_fail, rejected, failed, replied, true as is_baseline
  from (
    select distinct on (location, source_id) *
    from email_stats_daily
    where source = 'workflow-campaigns'
      and p_start is not null
      and snapshot_date < p_start
      and (p_location is null or location = p_location)
    order by location, source_id, snapshot_date desc
  ) baseline;
$$;

-- Retention: nothing ever pruned email_stats_daily (design spec deferred it).
-- At ~294 rows/day it hits ~107k rows/year; keep 400 days so a year-over-year
-- comparison can still resolve a baseline snapshot, prune the rest daily.
-- Same batched-delete-per-commit shape as
-- auth/migrations/065_abc_sync_run_log_retention.sql.
create extension if not exists pg_cron;

create or replace procedure prune_email_stats_daily(cutoff date, batch int default 200000)
language plpgsql as $$
declare n int;
begin
  loop
    delete from email_stats_daily
    where (location, source_id, snapshot_date) in (
      select location, source_id, snapshot_date from email_stats_daily
      where snapshot_date < cutoff
      limit batch
    );
    get diagnostics n = row_count;
    commit;
    exit when n = 0;
  end loop;
end;
$$;

-- (Re)register the daily prune. Idempotent: unschedule any existing job of the
-- same name first so re-running this migration does not create duplicates.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'prune-email-stats-daily') then
    perform cron.unschedule('prune-email-stats-daily');
  end if;
end $$;

-- Daily at 10:20 UTC (~2am PT, offset from the abc_sync_run_log prune at
-- :10 so the two batched deletes don't overlap): keep the last 400 days.
select cron.schedule(
  'prune-email-stats-daily',
  '20 10 * * *',
  $$call prune_email_stats_daily((now() - interval '400 days')::date, 200000)$$
);
