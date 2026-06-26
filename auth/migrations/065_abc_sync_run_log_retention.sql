-- abc_sync_run_log retention.
--
-- abc_sync_run_log is the ABC reconciler's per-action audit log: one row per
-- contact-action per run, written every ~30 min by ghl-sync. It grows ~85k
-- rows/day and is append-only, so it had ballooned to 6.2M rows / 2 GB.
--
-- Nothing reads rows older than a couple weeks: the run *list* + run-level
-- stats come from the separate abc_sync_runs summary table; the big log is only
-- read when drilling into a specific recent run (auth/src/routes/abcSync.js:
-- /summary, /changelog, /unmatched — all by run_id) and the dedupe/error tooling
-- only looks back 48h. So we keep a 14-day window and prune the rest daily.
--
-- Applied live on 2026-06-26 (one-time purge of ~4.99M rows + VACUUM ANALYZE via
-- the Supabase admin connection); this migration records the procedure + schedule
-- so a rebuilt database recreates the retention job. The one-time backfill purge
-- is intentionally NOT included here — on a fresh database there is nothing old
-- to delete, and the procedure issues COMMITs that cannot run inside the
-- migration transaction (pg_cron runs it in its own session, where COMMIT works).

create extension if not exists pg_cron;

-- Batched, per-commit prune so it never holds one long lock/transaction. It only
-- ever deletes OLD rows, so it does not conflict with the reconciler's inserts of
-- new rows. cutoff = retention boundary; batch = rows deleted per committed pass.
create or replace procedure prune_abc_sync_run_log(cutoff timestamptz, batch int default 200000)
language plpgsql as $$
declare n int;
begin
  loop
    delete from abc_sync_run_log
    where id in (
      select id from abc_sync_run_log
      where run_at < cutoff
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
  if exists (select 1 from cron.job where jobname = 'prune-abc-sync-run-log') then
    perform cron.unschedule('prune-abc-sync-run-log');
  end if;
end $$;

-- Daily at 10:10 UTC (~2am PT): keep the last 14 days, prune older.
select cron.schedule(
  'prune-abc-sync-run-log',
  '10 10 * * *',
  $$call prune_abc_sync_run_log(now() - interval '14 days', 200000)$$
);
