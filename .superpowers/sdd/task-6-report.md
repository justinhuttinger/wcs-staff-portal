# Task 6: Lapsed check-in admin routes — report

## Files
- Created `auth/src/config/lapsedSeed.js` — byte-identical mirror of `ghl-sync/src/abc/lapsedConfig.js` `SEED_EXCLUDED_TYPES` (verified with `JSON.stringify` equality check).
- Created `auth/src/routes/lapsedCheckinsHelpers.js` — pure helpers: `resolveActivityDate`, `pacificToday`, `daysBetween`, `daysSinceForMember`, `bucketTier`, `tierDayRange`, `inTierRange`, `normalizeExcludedInput`.
- Created `auth/src/routes/lapsedCheckinsHelpers.test.js` — `node --test` coverage for the pure helpers (8 tests).
- Created `auth/src/routes/lapsedCheckins.js` — the 4 admin-gated endpoints.
- Modified `auth/src/index.js` — mounted `app.use('/admin/lapsed-checkins', require('./routes/lapsedCheckins'))` next to the other `/admin/*` mounts (line ~114).

## Admin gate
Matched the Forms-admin pattern exactly, but used the plainer `requireRole('admin')` gate (same one `auth/src/routes/cacheAdmin.js` and `auth/src/routes/exports.js` use for admin-only, no-grant-exception modules), per the task instruction "admin tier ... same gate as Forms admin":
```js
router.use(authenticate)
router.use(requireRole('admin'))
```
(`requireFormsBuilder` in `auth/src/services/formsPermissions.js` additionally allows a non-admin with an explicit `forms` RBAC grant — that per-module grant exception doesn't apply here since there's no analogous "lapsed-checkins" grant key defined anywhere, so plain `requireRole('admin')` is the correct, simpler match.)

## Supabase client
`const { supabaseAdmin } = require('../services/supabase')` — same service-role client every other route file uses.

## Raw-SQL decision
The plan's dashboard SQL (CTE + `days_since` + `count(*) filter`) would require a new Postgres RPC function, which in turn needs a migration (see `reports.js`/`revenueReports.js`/`trends12mo.js` — every raw-SQL route in this codebase goes through `supabaseAdmin.rpc('some_function', args)` backed by a migration-created function). The plan's Global Constraints explicitly state "No schema migration required" for this whole feature, and Task 6 lists no migration step. So I took the plan's explicit fallback: **replicated the SQL's logic with the Supabase query builder + JS-side bucketing**, using the same activity-date coalesce order and Pacific-day math as pure, unit-tested functions (`lapsedCheckinsHelpers.js`). This keeps behavior byte-for-byte equivalent to the SQL without adding a migration.

## Endpoints (all under `/admin/lapsed-checkins`, all `requireRole('admin')`)
1. `GET /types` — counts `abc_members` grouped by `membership_type` (where `is_active = true`), cross-referenced against the excluded set loaded from `app_config.lapsed_checkin_excluded_types` (falls back to `SEED_EXCLUDED_TYPES` if the row is absent or empty). Sorted by `active_members` desc.
2. `PUT /types` — body `{ excluded: string[] }`, validated via `normalizeExcludedInput` (must be an array of strings; trims and dedupes), upserted into `app_config` (`onConflict: 'key'`), matching the exact upsert shape used by `auth/src/routes/config.js` (`PUT /config/app-settings`, `PUT /config/launcher-version`).
3. `GET /dashboard` — loads eligible members (`is_active = true`, `member_status = 'Active'`, `membership_type` not in the excluded set — filtered in JS to avoid Supabase `.in`/`.not` array-escaping issues with membership-type strings containing commas/dashes), computes `days_since` per member via `daysSinceForMember`, buckets into `tier10`/`tier21`/`tier30` per club, and includes every known club (even zero-count) using `auth/src/config/ghlLocations.js` `LOCATIONS` for the `club_number -> name` map (`clubCode` field).
4. `GET /dashboard/:club/:tier` — same eligibility filter scoped to `:club` (`club_number`), `:tier` validated via `tierDayRange` (`10` -> 10-20, `21` -> 21-29, `30` -> 30+; unknown tier -> 400), filters via `inTierRange`, sorted `days_since desc`, returns `{ member_id, name, membership_type, days_since, last_check_in }`.

## Tests
`node --test auth/src/routes/lapsedCheckinsHelpers.test.js` — 8/8 pass:
- `resolveActivityDate` coalesce order (last_check_in -> sign_date -> begin_date -> since_date -> null)
- `daysSinceForMember` matches the plan's worked examples (10 days, 5-day grace-period fallback, null when nothing present)
- `bucketTier` boundaries (9 -> null, 10/20 -> tier10, 21/29 -> tier21, 30/365 -> tier30)
- `tierDayRange` valid (`'10'`,`'21'`,`'30'`) + invalid (`'99'`,`'abc'`) params
- `inTierRange` bounds behavior including unbounded tier30 and null days
- `normalizeExcludedInput` happy path (trim+dedupe), non-array rejection, non-string-entry rejection

The route handlers themselves (thin DB wrappers per the plan) were not separately unit-tested, matching the plan's guidance ("these are thin DB wrappers"; manual curl verification is optional/deferred since there's no local Supabase env in this worktree).

## Verification commands + output
```
node -e "... compare SEED_EXCLUDED_TYPES ..."   -> identical: true
node --check auth/src/routes/lapsedCheckins.js  -> (no output = pass)
node --check auth/src/index.js                  -> (no output = pass)
node --check auth/src/routes/lapsedCheckinsHelpers.js -> (no output = pass)
cd auth && node --test src/routes/lapsedCheckinsHelpers.test.js -> # pass 8, # fail 0
```

## Commit
Branch `feat/lapsed-checkin-tagging`, commit message:
`feat(auth): admin endpoints for lapsed check-in exclusions + dashboard`
(hash recorded after commit — see final response)

## Concerns
- No live Supabase credentials in this worktree, so the 4 endpoints were verified only via `node --check` + code-review against existing patterns (`config.js`, `reports.js`), not a live `curl`. This matches the plan's own Step 3 guidance that manual curl verification / a fixture-driven SQL test is optional for these "thin DB wrappers."
- `GET /types` counts ALL distinct `membership_type` values including ones not in the seed/current excluded list — this matches the plan's spec exactly (admin needs to see every type to decide what to exclude), not a bug.
- Did not implement Task 7 (portal UI) — out of scope per instructions.
- Did not touch ghl-sync files (Tasks 1-5) — they already existed in the worktree from prior task work.

---

# Fix pass — review findings (2026-07-14)

## Finding 1 [Critical] — Pagination in auth `abc_members` reads

`auth/src/routes/lapsedCheckins.js` had two unbounded `abc_members` reads
that silently truncated at Supabase's 1000-row default:
- `GET /types` member-count query (`.select('membership_type').eq('is_active', true)`)
- `loadEligibleMembers()` (used by `GET /dashboard` and the drill-down)

Fix: added a `fetchAllRows(buildQuery)` helper that loops `.range(from, from+PAGE_SIZE-1)`
(PAGE_SIZE 1000), accumulating pages and breaking on a short page — mirrors
`ghl-sync/src/abc/lapsedTaggingJob.js`'s existing `.range()` loop pattern
exactly (fresh query builder per page via a factory function, not a reused
builder instance). Applied to:
- `GET /types`'s member query
- `loadEligibleMembers()`
- the new `loadKnownMembershipTypes()` (finding 3)

## Finding 2 [Important] — Join-date fallback parity (ghl-sync job)

`ghl-sync/src/abc/lapsedTaggingJob.js` used
`const join = member.sign_date ?? member.begin_date ?? member.since_date`,
which only skips `null`/`undefined` — an empty-string `sign_date` was kept,
producing `days=null` even with a valid `begin_date`.

Verified the auth side (`resolveActivityDate` in
`auth/src/routes/lapsedCheckinsHelpers.js`) already handles this correctly:
`toDateOnly()` returns `null` for any falsy/non-string input (including `''`
and, after `.trim()`, whitespace-only strings), so blanks are skipped at
every fallback step. No gap found there — added a dedicated test
(`resolveActivityDate: skips blank/empty-string fields, not just
null/undefined`) to lock that behavior in, since it wasn't explicitly
covered before.

Fix (job side): changed the join resolution to
```js
const join = [member.sign_date, member.begin_date, member.since_date]
  .find(v => v && String(v).trim()) || null;
```
which picks the first non-blank value, matching auth's behavior.

Added test `runLapsedTaggingForLocation: blank sign_date falls through to
begin_date (not treated as null)` in `lapsedTaggingJob.test.js` — a member
with `sign_date: ''` and a valid `begin_date` far in the past gets tagged
`lapsed-30d` (proving `begin_date` was used, not `null`).

## Finding 3 [Important] — `PUT /types` known-type validation

Added `loadKnownMembershipTypes()` in `lapsedCheckins.js`: pages through
ALL `abc_members` rows (no `is_active` filter, so rarely-active types still
validate) and returns the distinct `membership_type` set.

Extracted the pure filtering logic into `findUnknownTypes(list, knownTypes)`
in `lapsedCheckinsHelpers.js` — takes the normalized `excluded` list and a
known-types Set/array, returns `{ ok, unknown }`.

`PUT /types` now: (1) shape-validates via existing `normalizeExcludedInput`,
(2) loads known types, (3) rejects with HTTP 400 +
`{ error: 'excluded contains unknown membership types', unknown: [...] }`
if any submitted entry isn't in the known set.

Unit tests added to `lapsedCheckinsHelpers.test.js`:
- `findUnknownTypes: all entries known -> ok true, empty unknown list`
- `findUnknownTypes: unknown entries rejected and listed`
- `findUnknownTypes: accepts a plain array as the known set; preserves the
  caller-deduped input order/shape (does not dedupe itself)`

## Test runs (all passing)

### `cd ghl-sync && node --test src/abc/*.test.js`
```
# tests 33
# suites 0
# pass 33
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 615.5498
```
(includes the new blank-sign_date job test, ok 28, and the pre-existing
pagination test, ok 29)

### `cd auth && node --test src/routes/lapsedCheckinsHelpers.test.js`
```
# tests 12
# suites 0
# pass 12
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 264.4651
```
(includes the 3 new `findUnknownTypes` tests, ok 10-12, and the new blank
`resolveActivityDate` test, ok 1)

### `node --check` on the two auth files
```
node --check src/routes/lapsedCheckins.js  -> OK
node --check src/routes/lapsedCheckinsHelpers.js  -> OK
```

## Fix commit
`fix(lapsed-checkin): paginate auth queries, join-date blank-skip parity, known-type validation`
(hash recorded after commit — see final response)
