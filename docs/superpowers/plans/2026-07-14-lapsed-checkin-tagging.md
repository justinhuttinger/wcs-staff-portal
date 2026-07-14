# Lapsed Check-in Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A nightly ghl-sync job tags active members lapsed 10/21/30 days for GHL win-back workflows, with membership-type exclusions managed from an admin portal page and an at-risk dashboard.

**Architecture:** Pure, unit-tested logic (days-since, tier, tag-diff, eligibility) in a new ghl-sync module; a nightly `node-cron` job wires it to `abc_members` + the existing GHL tag writer, reading a membership-type exclusion list from `app_config`. New admin auth endpoints expose the exclusion list and an at-risk dashboard; a portal Admin page renders both tabs. Dark-launched behind env flags, dry-run first.

**Tech Stack:** Node/Express (ghl-sync + auth), `node-cron`, Supabase JS, React 19 + Vite + Tailwind (portal), `node --test`.

## Global Constraints

- Supabase project `ybopxxydsuwlbwxiuzve`; `abc_members`, `ghl_contacts_v2`, `app_config`, `abc_sync_run_log` already exist. **No schema migration required** (exclusions live in an `app_config` row).
- ABC timestamps (`last_check_in_timestamp`) are raw text in **Pacific** local time. All days-since math is on Pacific calendar days.
- GHL tag writes use the existing `ghl-sync/src/ghl/client.js` `put()` helper (`Version: 2021-07-28`, per-location pit token, `sleep(650)` between writes). Tags are a full read-modify-write array — never drop non-lapsed tags.
- Tag strings: `lapsed-10d`, `lapsed-21d`, `lapsed-30d`. Tiers: 10 / 21 / 30 days, mutually exclusive, 30d terminal.
- Feature flags (ghl-sync env): `LAPSED_TAGGING_ENABLED` (default false), `LAPSED_TAGGING_DRY_RUN` (default true), `LAPSED_TAGGING_HOUR` (PST, optional).
- Eligibility: `is_active = true` AND `member_status = 'Active'` AND `membership_type` not in the exclusion list.
- Follow existing repo conventions: ghl-sync CommonJS `require`; portal lockfile is `portal/package-lock.json` (npm); admin gating mirrors the Forms module (admin tier).
- Never merge; open PRs only. Work stays in the `feat/lapsed-checkin-tagging` worktree.

---

## Phase 1 — ghl-sync pure logic (`lapsedTagging` module)

### Task 1: Days-since-last-activity + tier selection

**Files:**
- Create: `ghl-sync/src/abc/lapsedTagging.js`
- Test: `ghl-sync/src/abc/lapsedTagging.test.js`

**Interfaces:**
- Produces:
  - `parseAbcPacificDate(text: string|null): Date|null` — parse a raw ABC timestamp/date string as a Pacific calendar date (midnight PT), or null.
  - `daysSince(activityDateText: string|null, joinDateText: string|null, nowPacific: Date): number|null` — whole Pacific calendar days since `COALESCE(activity, join)`; null if both missing.
  - `selectTier(days: number|null): 'lapsed-30d'|'lapsed-21d'|'lapsed-10d'|null`

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test')
const assert = require('node:assert')
const { daysSince, selectTier, parseAbcPacificDate } = require('./lapsedTagging')

// Fixed "now": 2026-07-14 12:00 PT
const NOW = new Date('2026-07-14T19:00:00Z')

test('daysSince: uses last check-in when present', () => {
  assert.strictEqual(daysSince('2026-07-04T10:00:00', '2026-01-01', NOW), 10)
})
test('daysSince: falls back to join date when no check-in (grace period)', () => {
  assert.strictEqual(daysSince(null, '2026-07-09', NOW), 5)
})
test('daysSince: null when both missing', () => {
  assert.strictEqual(daysSince(null, null, NOW), null)
})
test('selectTier: boundaries', () => {
  assert.strictEqual(selectTier(9), null)
  assert.strictEqual(selectTier(10), 'lapsed-10d')
  assert.strictEqual(selectTier(20), 'lapsed-10d')
  assert.strictEqual(selectTier(21), 'lapsed-21d')
  assert.strictEqual(selectTier(29), 'lapsed-21d')
  assert.strictEqual(selectTier(30), 'lapsed-30d')
  assert.strictEqual(selectTier(365), 'lapsed-30d')
  assert.strictEqual(selectTier(null), null)
})
test('parseAbcPacificDate: handles date-only and null', () => {
  assert.ok(parseAbcPacificDate('2026-07-09') instanceof Date)
  assert.strictEqual(parseAbcPacificDate(null), null)
  assert.strictEqual(parseAbcPacificDate(''), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/abc/lapsedTagging.test.js`
Expected: FAIL (module not found / functions undefined)

- [ ] **Step 3: Implement**

```js
// Compute Pacific-calendar-day differences. ABC strings are Pacific local.
// We reduce each date to a Pacific Y-M-D and diff at UTC-midnight to avoid
// DST-hour drift (matches the pattern used elsewhere for ABC dates).
const PACIFIC = 'America/Los_Angeles'

function pacificYMD(date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date) // "YYYY-MM-DD"
  return p
}

function parseAbcPacificDate(text) {
  if (!text || typeof text !== 'string') return null
  const t = text.trim()
  if (!t) return null
  // Accept "YYYY-MM-DD" or full timestamps ("YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DD HH:mm:ss")
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  // Anchor at UTC midnight of that calendar day for stable day math.
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
}

function daysSince(activityDateText, joinDateText, nowPacific) {
  const activity = parseAbcPacificDate(activityDateText) || parseAbcPacificDate(joinDateText)
  if (!activity) return null
  const todayYMD = pacificYMD(nowPacific)
  const today = new Date(`${todayYMD}T00:00:00Z`)
  const ms = today.getTime() - activity.getTime()
  return Math.floor(ms / 86400000)
}

function selectTier(days) {
  if (days == null) return null
  if (days >= 30) return 'lapsed-30d'
  if (days >= 21) return 'lapsed-21d'
  if (days >= 10) return 'lapsed-10d'
  return null
}

module.exports = { parseAbcPacificDate, daysSince, selectTier }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/abc/lapsedTagging.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/abc/lapsedTagging.js ghl-sync/src/abc/lapsedTagging.test.js
git commit -m "feat(ghl-sync): days-since + tier selection for lapsed tagging"
```

### Task 2: Tag diffing + eligibility

**Files:**
- Modify: `ghl-sync/src/abc/lapsedTagging.js`
- Test: `ghl-sync/src/abc/lapsedTagging.test.js`

**Interfaces:**
- Produces:
  - `LAPSED_TAGS: string[]` — `['lapsed-10d','lapsed-21d','lapsed-30d']`
  - `diffTags(currentTags: string[], desiredTier: string|null): { tags: string[], added: string[], removed: string[], changed: boolean }` — returns the new full tag array holding at most the one desired lapsed tag, all non-lapsed tags preserved.
  - `isEligible(member: {is_active, member_status, membership_type}, excludedTypes: Set<string>): boolean`

- [ ] **Step 1: Write the failing tests**

```js
const { diffTags, isEligible, LAPSED_TAGS } = require('./lapsedTagging')

test('diffTags: adds desired tier, strips other lapsed tags, preserves others', () => {
  const r = diffTags(['sale', 'vip', 'lapsed-10d'], 'lapsed-21d')
  assert.deepStrictEqual(new Set(r.tags), new Set(['sale', 'vip', 'lapsed-21d']))
  assert.deepStrictEqual(r.added, ['lapsed-21d'])
  assert.deepStrictEqual(r.removed, ['lapsed-10d'])
  assert.strictEqual(r.changed, true)
})
test('diffTags: no desired tier removes all lapsed tags', () => {
  const r = diffTags(['sale', 'lapsed-30d'], null)
  assert.deepStrictEqual(r.tags, ['sale'])
  assert.strictEqual(r.changed, true)
})
test('diffTags: no-op when already correct', () => {
  const r = diffTags(['sale', 'lapsed-10d'], 'lapsed-10d')
  assert.strictEqual(r.changed, false)
  assert.deepStrictEqual(new Set(r.tags), new Set(['sale', 'lapsed-10d']))
})
test('isEligible: active + Active status + non-excluded type', () => {
  const ex = new Set(['CORP'])
  assert.strictEqual(isEligible({ is_active: true, member_status: 'Active', membership_type: 'SINGLE' }, ex), true)
  assert.strictEqual(isEligible({ is_active: true, member_status: 'Freeze', membership_type: 'SINGLE' }, ex), false)
  assert.strictEqual(isEligible({ is_active: false, member_status: 'Active', membership_type: 'SINGLE' }, ex), false)
  assert.strictEqual(isEligible({ is_active: true, member_status: 'Active', membership_type: 'CORP' }, ex), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/abc/lapsedTagging.test.js`
Expected: FAIL (diffTags/isEligible undefined)

- [ ] **Step 3: Implement (append to lapsedTagging.js, extend module.exports)**

```js
const LAPSED_TAGS = ['lapsed-10d', 'lapsed-21d', 'lapsed-30d']
const LAPSED_SET = new Set(LAPSED_TAGS)

function diffTags(currentTags, desiredTier) {
  const current = Array.isArray(currentTags) ? currentTags : []
  const kept = current.filter(t => !LAPSED_SET.has(t))
  const tags = desiredTier ? [...kept, desiredTier] : kept
  const currentLapsed = current.filter(t => LAPSED_SET.has(t))
  const added = desiredTier && !current.includes(desiredTier) ? [desiredTier] : []
  const removed = currentLapsed.filter(t => t !== desiredTier)
  return { tags, added, removed, changed: added.length > 0 || removed.length > 0 }
}

function isEligible(member, excludedTypes) {
  return member.is_active === true
    && member.member_status === 'Active'
    && !excludedTypes.has(member.membership_type)
}

module.exports = { parseAbcPacificDate, daysSince, selectTier, diffTags, isEligible, LAPSED_TAGS }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/abc/lapsedTagging.test.js`
Expected: PASS (all Task 1 + Task 2 tests)

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/abc/lapsedTagging.js ghl-sync/src/abc/lapsedTagging.test.js
git commit -m "feat(ghl-sync): tag diffing + eligibility for lapsed tagging"
```

---

## Phase 2 — ghl-sync job wiring

### Task 3: Exclusion config loader

**Files:**
- Modify: `ghl-sync/src/abc/lapsedTagging.js` (add async DB loader) OR create `ghl-sync/src/abc/lapsedConfig.js`
- Test: `ghl-sync/src/abc/lapsedConfig.test.js` (loader pure-parse test)

**Interfaces:**
- Produces:
  - `SEED_EXCLUDED_TYPES: string[]` — the seed list (see spec §Membership-type exclusions).
  - `async loadExcludedTypes(db): Promise<Set<string>>` — reads `app_config` key `lapsed_checkin_excluded_types` (JSON array); returns `SEED_EXCLUDED_TYPES` as a Set if the row is missing.
  - `parseExcludedValue(value: any): string[]` — pure: coerce a stored value (array or JSON string) to a clean string array.

- [ ] **Step 1: Write failing test (pure parse only)**

```js
const test = require('node:test')
const assert = require('node:assert')
const { parseExcludedValue, SEED_EXCLUDED_TYPES } = require('./lapsedConfig')

test('parseExcludedValue: array passthrough, trims, drops non-strings', () => {
  assert.deepStrictEqual(parseExcludedValue(['CORP', ' NON-MEMBER ', 5, '']), ['CORP', 'NON-MEMBER'])
})
test('parseExcludedValue: JSON string', () => {
  assert.deepStrictEqual(parseExcludedValue('["CORP","STAFF"]'), ['CORP', 'STAFF'])
})
test('parseExcludedValue: garbage -> []', () => {
  assert.deepStrictEqual(parseExcludedValue(null), [])
  assert.deepStrictEqual(parseExcludedValue('not json'), [])
})
test('SEED_EXCLUDED_TYPES contains the agreed buckets', () => {
  for (const t of ['NON-MEMBER', 'CORP', 'A2 RECIP USE -Active Adult Reciprocal Use', 'GYMPASS - WELLHUB', 'EVENT ACCESS']) {
    assert.ok(SEED_EXCLUDED_TYPES.includes(t), `missing ${t}`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ghl-sync && node --test src/abc/lapsedConfig.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `ghl-sync/src/abc/lapsedConfig.js`**

```js
const SEED_EXCLUDED_TYPES = [
  // non-member / staff / non-gym
  'NON-MEMBER', 'Employee', 'Employee FAO', 'STAFF', 'PT ONLY', 'CHILDCARE',
  'Z. Deleting Individual', 'Standard M2M',
  // third-party subsidized
  'Active and Fit Limited', 'Active and Fit All Access', 'Active and Fit Premium',
  'GYMPASS - WELLHUB',
  // reciprocal use
  'A2 RECIP USE -Active Adult Reciprocal Use',
  // short-term / seasonal
  'SUMMER MEMBERSHIP', 'TEMPORARY SINGLE', 'TEMPORARY STUDENT', 'TEMPORARY COUPLE',
  'EVENT ACCESS',
  // corporate
  'CORP', 'Corporate Business',
]

const CONFIG_KEY = 'lapsed_checkin_excluded_types'

function parseExcludedValue(value) {
  let arr = value
  if (typeof value === 'string') {
    try { arr = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(arr)) return []
  return arr.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean)
}

async function loadExcludedTypes(db) {
  const { data } = await db.from('app_config').select('value').eq('key', CONFIG_KEY).maybeSingle()
  if (!data) return new Set(SEED_EXCLUDED_TYPES)
  const parsed = parseExcludedValue(data.value)
  return new Set(parsed.length ? parsed : SEED_EXCLUDED_TYPES)
}

module.exports = { SEED_EXCLUDED_TYPES, CONFIG_KEY, parseExcludedValue, loadExcludedTypes }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ghl-sync && node --test src/abc/lapsedConfig.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ghl-sync/src/abc/lapsedConfig.js ghl-sync/src/abc/lapsedConfig.test.js
git commit -m "feat(ghl-sync): lapsed-tagging exclusion config loader + seed"
```

### Task 4: Per-location tagging pass

**Files:**
- Create: `ghl-sync/src/abc/lapsedTaggingJob.js`
- Reference (read for reuse): `ghl-sync/src/abc/reconcile.js` (member→contact indexing `~155-200`, tag PUT `~597-662`), `ghl-sync/src/ghl/client.js` (`get`/`put`), `ghl-sync/src/config/locations.js`, `ghl-sync/src/db.js` (supabase client accessor).

**Interfaces:**
- Consumes: `daysSince`, `selectTier`, `diffTags`, `isEligible` (Task 1–2); `loadExcludedTypes` (Task 3); GHL `get`/`put`; `LOCATIONS`.
- Produces:
  - `async runLapsedTaggingForLocation(location, { dryRun, db, now }): Promise<{ evaluated, matched, tagged, cleared, noMatch, byTier }>`
  - `async runLapsedTaggingAll({ dryRun }): Promise<summary[]>`

**Implementation notes (build to these, following reconcile.js patterns):**
1. Load `excludedTypes = await loadExcludedTypes(db)`.
2. Query members for the club:
   `db.from('abc_members').select('member_id, club_number, email, primary_phone, mobile_phone, first_name, last_name, is_active, member_status, membership_type, last_check_in_timestamp, sign_date, begin_date, since_date').eq('club_number', location.clubNumber).eq('is_active', true).eq('member_status', 'Active')`
3. Load `ghl_contacts_v2` for `location.id` and build the same match indexes reconcile.js uses (by `abc_member_id` custom field, by lowercased email, by last-10-digit phone). **Extract reconcile's indexer into a shared helper** `ghl-sync/src/abc/contactIndex.js` (`buildContactIndex(contacts, fieldDefs)` + `matchContact(index, member)`), and have both `reconcile.js` and this job import it (DRY; do not duplicate). Cover the extracted helper with a focused test.
4. For each eligible member: `join = sign_date ?? begin_date ?? since_date`; `days = daysSince(last_check_in_timestamp, join, now)`; `tier = selectTier(days)`. Resolve the GHL contact via `matchContact`; if none, count `noMatch` and continue.
5. GET the live contact, `diff = diffTags(contact.tags, tier)`. If `!diff.changed`, skip. Else if `dryRun`, log intended change to `abc_sync_run_log` (action `add_tag`/`remove_tag`, note `dry_run`); else `put('/contacts/:id', { tags: diff.tags }, location.apiKey)`, `sleep(650)`, log applied change.
6. Never write when unchanged; a member whose `tier` is null and who holds no lapsed tag is a no-op (no GET needed if the pre-indexed contact tags already lack lapsed tags — optimize by checking the indexed `tags` first, GET only when a change is likely).
7. Return the summary counts (including `byTier`).

- [ ] **Step 1:** Extract `contactIndex.js` from reconcile.js; write `contactIndex.test.js` (match by member_id, email, phone; family-plan guard). Run: `node --test src/abc/contactIndex.test.js` → FAIL then PASS. Update `reconcile.js` to import it; run existing reconcile tests if any to confirm no regression.
- [ ] **Step 2:** Write `lapsedTaggingJob.js` per notes above.
- [ ] **Step 3:** Add a smoke test `lapsedTaggingJob.test.js` that injects a fake `db` (returns fixture members + contacts) and a fake GHL `put`, asserts: eligible lapsed member → correct tier tag PUT; recently-checked-in member holding a lapsed tag → tag removed; excluded-type member → skipped; `dryRun` → no PUT, run-log written. Use dependency injection (pass `db`, `put` into the function) so no network/DB is touched.
- [ ] **Step 4:** Run `node --test src/abc/lapsedTaggingJob.test.js` → PASS.
- [ ] **Step 5:** Commit `feat(ghl-sync): lapsed-tagging per-location pass + shared contact index`.

### Task 5: Scheduler wiring + env flags

**Files:**
- Modify: `ghl-sync/src/scheduler.js` (add nightly cron, mirror the attribution-job template: PST→UTC `+8`, `running` guard)
- Modify: `ghl-sync/.env.example` (document the 3 flags)
- Reference: `ghl-sync/src/index.js:582` (startScheduler call site)

**Implementation notes:**
```js
// in startScheduler(), alongside the other cron jobs:
if (process.env.LAPSED_TAGGING_ENABLED === 'true') {
  const hour = Number(process.env.LAPSED_TAGGING_HOUR || 5)         // PST
  const hourUTC = (hour + 8) % 24
  const dryRun = process.env.LAPSED_TAGGING_DRY_RUN !== 'false'      // default true
  let running = false
  cron.schedule(`0 ${hourUTC} * * *`, async () => {
    if (running) return
    running = true
    try {
      const summary = await runLapsedTaggingAll({ dryRun })
      console.log('[lapsedTagging]', JSON.stringify(summary))
    } catch (err) {
      console.error('[lapsedTagging] failed:', err.message)
      await alertSyncFailed(err).catch(() => {})
    } finally { running = false }
  })
  console.log(`[scheduler] lapsed tagging scheduled ${hourUTC}:00 UTC (dryRun=${dryRun})`)
}
```
Add an on-demand endpoint `POST /api/lapsed-tagging/run` (SYNC_SECRET-guarded, body `{ dryRun }`) in `ghl-sync/src/index.js` so the dry-run can be triggered manually during rollout without waiting for the cron.

- [ ] **Step 1:** Add the cron block + manual endpoint. **Step 2:** Add the 3 env vars to `.env.example` with comments. **Step 3:** `cd ghl-sync && node -e "require('./src/scheduler.js')"` to confirm it loads without syntax error (flag off = inert). **Step 4:** Commit `feat(ghl-sync): schedule nightly lapsed tagging behind env flag`.

---

## Phase 3 — auth API (admin endpoints)

### Task 6: Lapsed check-in admin routes

**Files:**
- Create: `auth/src/routes/lapsedCheckins.js`
- Modify: `auth/src/index.js` (mount `/admin/lapsed-checkins`, admin-gated like Forms admin)
- Reference: `auth/src/routes/forms.js` / admin gating middleware; `auth/src/config/ghlLocations.js` (club list for club→name); the seed list from `ghl-sync/src/abc/lapsedConfig.js` (duplicate the seed array here as `auth/src/config/lapsedSeed.js` or read via shared constant — keep ONE source; simplest: a tiny shared JSON in `auth/src/config/`).

**Interfaces (endpoints, all admin-gated):**
- `GET /admin/lapsed-checkins/types` → `{ types: [{ membership_type, active_members, excluded }], updated_at }`
  - SQL: distinct `membership_type` + count from `abc_members where is_active` ; cross-reference `app_config.lapsed_checkin_excluded_types` (seed if absent).
- `PUT /admin/lapsed-checkins/types` body `{ excluded: string[] }` → upsert the `app_config` row; validate each is a known type string; return the saved list. Log to an audit table if one exists for admin config (else console).
- `GET /admin/lapsed-checkins/dashboard` → `{ clubs: [{ club, name, tier10, tier21, tier30 }], generated_at }`
  - Compute with a single SQL query over `abc_members` mirroring the job's eligibility + days-since (see SQL below).
- `GET /admin/lapsed-checkins/dashboard/:club/:tier` → `{ members: [{ member_id, name, membership_type, days_since, last_check_in }] }`

**Dashboard SQL (Pacific day math in Postgres; parameterize excluded types):**
```sql
with base as (
  select member_id, first_name, last_name, membership_type, last_check_in_timestamp,
         coalesce(
           nullif(left(last_check_in_timestamp,10),'')::date,
           sign_date, begin_date, since_date
         ) as activity_date,
         club_number
  from abc_members
  where is_active = true and member_status = 'Active'
    and membership_type <> all ($1)   -- excluded types array
),
scored as (
  select *, ( (now() at time zone 'America/Los_Angeles')::date - activity_date ) as days_since
  from base where activity_date is not null
)
select club_number,
  count(*) filter (where days_since between 10 and 20) as tier10,
  count(*) filter (where days_since between 21 and 29) as tier21,
  count(*) filter (where days_since >= 30)             as tier30
from scored group by club_number;
```
(Drill-down: same CTE, filter to `:club` and the `:tier` day-range, order by `days_since desc`.)

- [ ] **Step 1:** Write route file with the four handlers using the auth service's Supabase client + admin middleware. **Step 2:** Mount in `index.js`. **Step 3:** Manual verify with a local token: `curl` each endpoint (or a `node --test` hitting the SQL against a fixture is optional; these are thin DB wrappers). **Step 4:** Confirm the exclusion array shared with ghl-sync stays byte-identical (same seed source). **Step 5:** Commit `feat(auth): admin endpoints for lapsed check-in exclusions + dashboard`.

---

## Phase 4 — portal admin UI

### Task 7: "Lapsed Check-ins" admin page

**Files:**
- Create: `portal/src/components/admin/LapsedCheckins.jsx` (tabbed: Exclusions | At-Risk)
- Modify: portal API client (add `lapsedCheckins` calls), Admin panel registration + tile (admin-only, mirror Forms admin entry), any ToolGrid/Admin index that lists admin sections.
- Reference: `portal/src/components/admin/FormsAdmin.jsx` for the admin-section pattern, card/dark-backdrop styling (wrap every block in a `bg-surface` card), and how admin sections mount with a back button.

**Behavior:**
- **Exclusions tab:** table of `{ membership_type, active_members, excluded }` from `GET /types`, each row a toggle; a Save button `PUT /types` with the checked set; "Saved" confirmation. Sort by active_members desc.
- **At-Risk tab:** per-club cards or a table with tier10/tier21/tier30 counts from `GET /dashboard`; clicking a count opens the drill-down list (`GET /dashboard/:club/:tier`) in a modal (mobile: `createPortal` to body per the modal convention). Show days-since and last-check-in per member.
- All content in `bg-surface` cards (dark backdrop). Admin-only; non-admins never see the tile.

- [ ] **Step 1:** Add API client methods. **Step 2:** Build the Exclusions tab (fetch, toggle, save). **Step 3:** Build the At-Risk tab (counts + drill-down modal). **Step 4:** Register the admin section + tile gated to admin. **Step 5:** `cd portal && npm run build` → succeeds. **Step 6:** Commit `feat(portal): admin Lapsed Check-ins page (exclusions + at-risk dashboard)`.

---

## Phase 5 — verify + PRs

### Task 8: Full test run, PRs, rollout notes

- [ ] Run `cd ghl-sync && node --test src/abc/*.test.js` → all PASS.
- [ ] `cd portal && npm run build` → PASS.
- [ ] Push branch; open **one PR** (all surfaces are one feature) to `master` with: what it does, the dark-launch/dry-run rollout steps (spec §Rollout), the fact that no schema migration is needed, and the env flags to set. Do NOT merge.
- [ ] In the PR body, list the manual rollout sequence: set `LAPSED_TAGGING_ENABLED=true` + `LAPSED_TAGGING_DRY_RUN=true` on the ghl-sync Render service → trigger `POST /api/lapsed-tagging/run {dryRun:true}` → review dashboard + run-log per club → build GHL workflows → flip `DRY_RUN=false`.

---

## Self-review notes

- **Spec coverage:** tiers/lifecycle (T1–2,4), grace period via join fallback (T1), eligibility + exclusions (T2–3,6), Pacific-day math (T1, T6 SQL), member→contact reuse (T4 shared `contactIndex`), tag writer reuse (T4), scheduler + flags + dry-run (T5), admin exclusions + dashboard (T6–7), rollout (T5 manual endpoint + T8). All spec sections mapped.
- **Shared exclusion seed:** one source of truth — ghl-sync `lapsedConfig.SEED_EXCLUDED_TYPES`; auth mirrors it via a small shared config file kept byte-identical (called out in T6). Both read the live value from `app_config` at runtime, so the seed only matters before first save.
- **No new migration:** exclusions in `app_config`; dashboard computed live.
