# auth memory leak fixes -- report

Branch: fix/auth-memory-leaks (worktree C:\Users\justi\wcs-worktrees\auth-memory), based on master.

## 1. Unbounded module-scope caches (CRITICAL)

Replaced the hand-rolled Map() caches in auth/src/routes/ptHealth.js, auth/src/routes/deactivatedPT.js,
and auth/src/routes/ptNewClients.js with the shared auth/src/services/memoryCache.js helper (get/set/wrap),
namespacing keys per route so identical clubNumber:memberId strings from different files never collide in the
shared store:

- ptHealth.js: historyCache, memberRSCache -> pt-health:history:*, pt-health:member-rs:*, 5 min TTL.
- deactivatedPT.js: historyCache, memberRSCache -> deactivated-pt:history:*, deactivated-pt:member-rs:*,
  5 min TTL. planCache -> deactivated-pt:plan:*, kept its original 1h TTL (lower cardinality: bounded by
  distinct recurring-service plans, not members).
- ptNewClients.js: purchaseHistoryCache -> pt-new-clients:purchase-history:*, 5 min TTL. planCache ->
  pt-new-clients:plan:*, kept its original 1h TTL.

Behavior preserved exactly, including a subtlety I checked rather than assumed: the history/RS/purchase-history
caches originally cached failures too (catch { cache.set(key, [])... }), so those now use wrap() directly -- a
failed producer there resolves to [], which wrap caches like any other value, matching prior behavior.
The two plan-lookup caches (fetchPlanName in deactivatedPT.js, fetchPlanDetail in ptNewClients.js) originally
did NOT cache failures (catch { return null } with no .set()). Using wrap() there would have changed that --
wrap always caches whatever the producer resolves to, including a caught-and-returned null -- so those two
functions instead use memoryCache.get()/memoryCache.set() directly, only writing to the cache on the success
path. This is a genuine behavioral fork in memoryCache's API (wrap vs. manual get/set) -- flagging it here as
requested rather than silently picking one.

ptHealth.js doesn't have a plan-name cache (deactivatedPT/ptNewClients do), so it only needed the two
member-keyed caches converted.

## Shared memoryCache.js hardening

Added a hard entry cap so the cache can't grow without bound even for a high-cardinality, write-heavy key space
that's rarely re-read (exactly what the three route caches above are):

- MAX_ENTRIES = 20000 (module-scope const). set() (and the internal wrapSWR background/cold-miss writes,
  now routed through a shared writeEntry() helper) evict the oldest entries -- by Map insertion order -- before
  inserting a genuinely NEW key. Overwriting an existing key doesn't grow store.size, so it can't itself
  trigger eviction; a key that's refreshed also gets re-inserted (delete-then-set) so it counts as "freshest"
  for eviction ordering, not stuck at its original insertion slot.
- Added a sweepExpired() pass on a setInterval(..., 5 min).unref() timer, so entries that are written once and
  never read again (which is most of the member-keyed lookups above -- a report run touches a member once) get
  reclaimed on a timer instead of sitting until the next read of that exact key, which per the original
  memoryCache design might never come.
- New evictions counter added to getStats(), alongside the existing counters (all preserved).
- MAX_ENTRIES, _store (the raw Map), sweepExpired, startSweep, stopSweep are now exported -- _store
  and sweepExpired for the new unit tests, the rest so a future consumer/test can reason about the sweep timer
  without reaching into internals.

All 7 existing memoryCache consumers (roles, permissions, drive-folder listings, group-X, facility schedules,
marketing-tracker, abcRecurring) are low-cardinality (single-digit to low-hundreds of distinct keys per
process lifetime) and were already well under 20,000 entries, so the cap changes nothing observable for them.

Design rationale for the cap size (20,000): chosen to comfortably exceed any legitimate working set (thousands
of PT members x a handful of lookup types across 7 clubs, refreshed every 5 minutes) while still bounding worst-case
memory to a small, fixed number of entries regardless of how the cache is used in the future. I did not find a
place in the existing code that reads getStats().size and asserts a specific ceiling, so I'm confident the cap
doesn't change behavior for any current caller -- flagging that I did not exhaustively grep every possible external
consumer of /admin/cache/stats (the only route that surfaces size) beyond cacheAdmin.js, which just returns it
verbatim as JSON.

## 2. /email-marketing/automations unbounded history load

auth/migrations/112_email_automation_period.sql adds email_automation_period(p_start date, p_end date,
p_location text), a STABLE SQL function using two DISTINCT ON (location, source_id) ... ORDER BY location,
source_id, snapshot_date DESC selects unioned together -- one for "latest at/before p_end" (is_baseline = false),
one for "latest strictly before p_start" (is_baseline = true, only emitted when p_start IS NOT NULL, matching
the old if (start_date && ...) guard). Bounds the result at <=2 rows per campaign (~600 today) regardless of table
size, replacing the old unbounded paged full-table scan.

Rewrote the handler in auth/src/routes/emailMarketing.js to call it via supabaseAdmin.rpc('email_automation_period', ...)
and dropped the paging loop entirely. emailAutomationMath.js (diffSnapshots/computeRates) is untouched -- the
handler still calls it the same way, just fed from <=2 rows per campaign instead of the whole table. Response shape
({ automations, totals, baseline_date }) is unchanged.

Verified the rewritten handler's logic directly (mocked supabaseAdmin.rpc + stubbed auth middleware, invoked the
Express route handler in isolation) against a hand-built fixture covering: a campaign with both a baseline and a
later snapshot (correct diffed counters, is_lifetime: false, uses the latest row's name/subject), a campaign
with only a latest snapshot (is_lifetime: true), and a campaign whose baseline and latest snapshots are identical
(zero-diff, correctly omitted per the existing if (!counters.sent) continue). baseline_date came back as the
correct max baseline date across campaigns. Transcript is in the Verification section below.

## 3. email_stats_daily retention

Same migration adds a 400-day pg_cron prune, matching the shape of auth/migrations/065_abc_sync_run_log_retention.sql
(the only existing pg_cron precedent, found in auth/migrations/): a prune_email_stats_daily(cutoff date, batch int)
procedure that deletes in committed batches of 200,000 keyed on the table's actual primary key
(location, source_id, snapshot_date) (this table has no surrogate id, unlike abc_sync_run_log), scheduled daily
via cron.schedule at 10:20 UTC -- 10 minutes offset from the existing 10:10 UTC abc_sync_run_log prune so the two
batched deletes don't overlap. Job registration is idempotent (unschedule-then-reschedule) like the precedent.

## 4. Memory verification instrumentation

auth/src/index.js, inside the existing app.listen(...) callback (same place as the other periodic
setInterval(...).unref() jobs already there, e.g. the RBAC role-tier refresh): logs process.memoryUsage()
every 15 minutes as one console.log line, e.g.
[memory] rss=142.3MB heapUsed=61.2MB external=8.4MB heapTotal=90.1MB nonHeap=81.1MB
Includes a comment explaining why external / rss - heapUsed matter specifically: canvas and
chartjs-node-canvas (used for the trends Excel export) allocate native memory outside the V8 heap, so a leak
there grows RSS without ever showing up in heapUsed and without ever producing a "JavaScript heap out of memory"
error -- which is exactly why the OOM that triggered this investigation left no heap-error breadcrumb.

## Verification

1. Module-load checks (all files touched):
   SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=dummy node -e "require('./src/routes/ptHealth.js'); require('./src/routes/deactivatedPT.js'); require('./src/routes/ptNewClients.js'); require('./src/routes/emailMarketing.js'); require('./src/services/memoryCache.js'); console.log('OK all load');"
   -> OK all load

   auth/src/index.js isn't require-safe in isolation (it calls app.listen at module scope), so it was checked
   with `node --check src/index.js` -> syntax OK, plus manual review of the added block.

2. Full suite: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node --experimental-websocket --test src/
   -> 615 tests total, 614 pass, 1 fail.
   The 1 failure is "builds a flat outcome payload from location + intake" (src/lib/tourWebhook.test.js) --
   unrelated to anything touched here, matches the documented pre-existing failure.
   The second documented pre-existing failure, src/services/blogAutomation/photo.test.js, PASSED in this
   run -- its 3 subtests (pickPhoto returns the top image match..., ...returns null when no matches,
   ...returns null and does not throw on embed error) are fully mocked/deterministic with no network calls, so
   this reads as already-fixed on current master rather than flaky. Flagging since it doesn't match the task's
   stated baseline exactly, but it is strictly better (one fewer failure) and nothing I touched overlaps that file.
   615 total vs. the stated baseline of 606 (604+2) is expected: I added 7 new memoryCache tests (see below);
   the rest of the gap is consistent with photo.test.js's 3 subtests moving from fail to pass plus normal
   test-count drift on master since the task was scoped -- not something introduced by this change (git status
   confirms only the intended files were touched).

3. New tests: auth/src/services/memoryCache.test.js (7 tests, all passing) --
   round-trip get/set within TTL; lazy eviction on expired get(); sweepExpired() removes expired entries
   without a read; set() enforces MAX_ENTRIES and evicts oldest-first on overflow (fills to exactly the cap,
   confirms no premature eviction, then confirms the single oldest key is evicted on the next insert and the
   store never exceeds the cap); overwriting an existing key does not count as growth and doesn't trigger
   eviction; getStats().evictions increments exactly once per overflow insert; wrap()-populated entries go
   through the same cap/eviction path as set().

4. Ad-hoc functional check of the rewritten /email-marketing/automations handler (mocked supabaseAdmin.rpc
   returning a hand-built fixture, stubbed auth middleware, handler invoked directly) -- see finding 2 above for
   the scenarios covered and results. Script lived in the scratch temp dir, not committed.

## Environment note

This worktree had no node_modules (git worktrees don't share it). Created a directory junction
auth/node_modules -> C:\Users\justi\wcs-staff-portal\auth\node_modules (the already-installed primary
checkout) to run tests -- no pnpm install was run and no lockfile was touched. This matches the existing
convention: other worktrees under wcs-worktrees\ have the same kind of node_modules linkage.
