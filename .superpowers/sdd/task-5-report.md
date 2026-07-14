# Task 5: Scheduler wiring + env flags — Report

## Scope
Phase 2, Task 5 only: nightly cron wiring for `runLapsedTaggingAll` + a manual
on-demand HTTP endpoint + the 3 env flags in `.env.example`. Task 6+ (auth
admin routes, portal UI) NOT touched.

## Files changed

### `ghl-sync/src/scheduler.js`
- Added import: `const { runLapsedTaggingAll } = require('./abc/lapsedTaggingJob');`
- Added a new cron block inside `startScheduler()`, copied from the nightly
  "Attribution enrichment" job's exact shape (PST→UTC `+8` conversion,
  `running` re-entrancy guard, `alertSyncFailed` on failure), guarded by
  `process.env.LAPSED_TAGGING_ENABLED === 'true'`:

```js
if (process.env.LAPSED_TAGGING_ENABLED === 'true') {
  const lapsedTaggingHour = Number(process.env.LAPSED_TAGGING_HOUR || 5); // PST
  const lapsedTaggingHourUTC = (lapsedTaggingHour + 8) % 24;
  const lapsedTaggingDryRun = process.env.LAPSED_TAGGING_DRY_RUN !== 'false'; // default true
  let lapsedTaggingRunning = false;
  cron.schedule(`0 ${lapsedTaggingHourUTC} * * *`, async () => {
    if (lapsedTaggingRunning) {
      console.warn('[Scheduler] Previous lapsed tagging run still running — skipping');
      return;
    }
    lapsedTaggingRunning = true;
    console.log('[Scheduler] Starting lapsed check-in tagging...');
    try {
      const summary = await runLapsedTaggingAll({ dryRun: lapsedTaggingDryRun });
      console.log('[Scheduler] Lapsed tagging results:', JSON.stringify(summary));
    } catch (err) {
      console.error('[Scheduler] Lapsed tagging failed:', err.message);
      await alertSyncFailed(err).catch(() => {});
    } finally {
      lapsedTaggingRunning = false;
    }
  });
  console.log(`[Scheduler] Lapsed tagging scheduled daily at ${lapsedTaggingHour}:00 PST (${lapsedTaggingHourUTC}:00 UTC), dryRun=${lapsedTaggingDryRun}`);
}
```

Placed just before the final `console.log` summary block (after the email
stats cron), so when the flag is off the job is fully inert — no cron
registered, no console noise.

`alertSyncFailed` was already imported at the top of the file (used by the ABC
sync, payroll sync, recurring PT sync, and attribution enrichment jobs) — no
new import needed for it.

### `ghl-sync/src/index.js`
- Added import: `const { runLapsedTaggingAll } = require('./abc/lapsedTaggingJob');`
- Added a new endpoint, guarded by the existing `requireSecret` middleware
  (checks `x-sync-secret` header against `SYNC_SECRET`, same as every other
  `/api/sync/*` route). Placed directly before `POST /api/sync/abc`:

```js
// POST /api/lapsed-tagging/run — on-demand lapsed check-in tagging pass across
// all locations, for rollout verification without waiting on the nightly cron.
// Body { dryRun?: boolean } — defaults to LAPSED_TAGGING_DRY_RUN (true unless
// explicitly set to 'false'). Awaits and returns the run summary directly
// (mirrors /api/sync/checkins/probe) rather than the fire-and-forget
// "started" pattern used by the heavier full/delta syncs.
app.post('/api/lapsed-tagging/run', requireSecret, async (req, res) => {
  try {
    const defaultDryRun = process.env.LAPSED_TAGGING_DRY_RUN !== 'false';
    const dryRun = typeof req.body?.dryRun === 'boolean' ? req.body.dryRun : defaultDryRun;
    const summary = await runLapsedTaggingAll({ dryRun });
    res.json({ dryRun, summary });
  } catch (err) {
    console.error('[API] Lapsed tagging run failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

Design choice: unlike the fire-and-forget `/api/sync/*` endpoints (which
return `{status:'started'}` immediately and run in the background), this
endpoint `await`s the full pass and returns the summary JSON synchronously —
matching the plan's explicit instruction ("calling runLapsedTaggingAll({
dryRun }) and returning the summary JSON") and the existing precedent set by
`POST /api/sync/checkins/probe` (also an awaited, JSON-returning handler).
This is intentional for the manual rollout-verification use case described in
the plan (trigger dry-run, inspect results immediately). Did not gate this
endpoint on the `syncRunning` flag since `runLapsedTaggingForLocation` writes
only `lapsed-*` tags to its own dedicated `abc_sync_run_log` rows and doesn't
touch the cursors/state the other syncs guard against concurrent mutation.

### `ghl-sync/.env.example`
Added after the `SYNC_SECRET=` line (near the other sync-related vars):

```
# Lapsed check-in tagging (nightly). Dark-launched: off by default, and even
# when enabled defaults to dry-run (logs intended tag changes to
# abc_sync_run_log without writing to GHL). Hour is PST.
LAPSED_TAGGING_ENABLED=false
LAPSED_TAGGING_DRY_RUN=true
LAPSED_TAGGING_HOUR=5
```

## Real names wired to
- `runLapsedTaggingAll` — from `./abc/lapsedTaggingJob` (already implemented, Task 4).
- `cron` — `require('node-cron')`, already imported in scheduler.js.
- `alertSyncFailed` — `require('./alerts')`, already imported in scheduler.js.
- `requireSecret` — existing middleware in index.js checking `x-sync-secret` header against `SYNC_SECRET`.
- `startScheduler()` — existing function; new block added inside it, no signature change.

## Verification

1. Syntax check (per task instructions, since `require`-loading `index.js`
   starts an Express server and `scheduler.js` transitively requires modules
   with unmet native deps in this worktree — see note below):
   ```
   cd ghl-sync && node --check src/index.js && node --check src/scheduler.js && echo OK
   ```
   Output: `OK`

2. Attempted `node -e "require('./src/scheduler.js')"` per the task's
   suggested command. It fails with `Error: Cannot find module 'sharp'`
   (native binary not installed for this worktree's `node_modules`), inside
   `src/media/imagePrep.js` (an unrelated, pre-existing dependency of
   `mediaIndex.js`, which `scheduler.js` already imported before this task).
   Confirmed via `git stash` that this failure is **pre-existing** on the
   branch (reproduces identically with my changes stashed out) — not caused
   by this task's edits. `node --check` (above) is the applicable syntax
   verification and passes clean.

3. Full abc test suite (unaffected by this task, run to confirm no regressions):
   ```
   cd ghl-sync && node --test src/abc/*.test.js
   ```
   Output: `# tests 32 / # pass 32 / # fail 0`

## Commit
`fc6...` — see `git log -1` on branch `feat/lapsed-checkin-tagging` for exact
hash (recorded below after commit).

## Concerns
- Pre-existing worktree issue: `sharp` (native module used by
  `src/media/imagePrep.js`) isn't installed in this worktree's
  `node_modules`, so `require('./src/scheduler.js')` and `require('./src/index.js')`
  both fail before ever reaching the new lapsed-tagging code. This blocks the
  exact `node -e "require(...)"` smoke test the task suggested; used
  `node --check` instead, which is unaffected by missing deps and confirms
  both files parse/compile cleanly. Flagging so a future task (or `npm
  install` in this worktree) can address it if a true `require()` smoke test
  is needed later.
- The manual endpoint intentionally does NOT set/check `syncRunning` (the
  flag other `/api/sync/*` endpoints use to prevent overlap). If desired,
  double-triggering the manual endpoint (or manual + cron firing
  simultaneously) could run two passes concurrently — each writes its own
  `abc_sync_run_log` rows with a distinct `run_id`, and tag writes are
  idempotent (read-modify-write to the same desired tier), so this is safe
  but not maximally efficient. Did not add a guard since the plan didn't ask
  for one and the existing `lapsedTaggingRunning` flag inside the cron
  closure only protects the cron from re-entering itself, not the manual
  endpoint from the cron.
