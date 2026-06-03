# Speed to Lead KPI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Speed to Lead" KPI — median minutes from Membership-pipeline opportunity creation ("New Lead") to first human outbound contact (manual SMS/call, `source:'app'`), shown in the experimental KPIs report with an admin "max minutes" goal (lower is better).

**Architecture:** `ghl-sync` computes, per Membership-pipeline opportunity, the first human contact time via the GHL Conversations API and stores it in a new `ghl_first_contact` table (compute-once, bounded). `auth` exposes `GET /reports/speed-to-lead` (median + mean + counts). `portal` generalizes the KPI model so a duration/lower-is-better KPI is first-class.

**Tech Stack:** Node/CommonJS (ghl-sync, auth/Express), Supabase/Postgres, React/Vite (portal), hand-rolled inline SVG charts, Node built-in test runner for pure logic.

**Spec:** `docs/superpowers/specs/2026-06-03-speed-to-lead-design.md`
**Worktree:** `.claude/worktrees/speed-to-lead` (branch `feat/speed-to-lead`). Paths below are relative to it.

**Grounding facts (verified):**
- GHL client `ghl-sync/src/ghl/client.js` (CommonJS) exports `{ get, post, put, getPaginated, sleep }`; `get(path, params, apiKey)` adds `Authorization: Bearer`, `Version: 2021-07-28`, retries 429.
- `ghl_opportunities_v2` has `contact_id`, `created_at_ghl`, and denormalized `pipeline_name` / `stage_name`.
- Message objects expose `direction`, `messageType` (`TYPE_SMS`/`TYPE_CALL`/…), `dateAdded` (ISO), `source` (`'app'` human, `'workflow'` automation).
- `deltaSync` (`ghl-sync/src/sync/deltaSync.js`) loops `LOCATIONS` (`{id,apiKey,name,slug,clubNumber}`) with per-entity try/catch + `writeSyncLog({ syncType, entity, locationId, recordsFetched, recordsUpserted, errors, startedAt })` from `./syncLog`. `supabase` from `../db/supabase`.
- Next migration number: `008`.
- Report helpers in `auth/src/routes/reports.js`: `resolveLocationFilter(query)`, `dateToMs(str, endOfDay)`, `applyDateRange(q, col, startMs, endMs)`, `applyLocationFilter(q, filter)`. Routes return JSON; mounted in the reports router.
- Portal helpers: `getMembershipReport`, `getAppSettings`, `saveAppSettings` in `portal/src/lib/api.js`; KPI report `portal/src/components/reports/KpiReport.jsx`; goals admin `portal/src/components/admin/KpiGoalsAdmin.jsx`; pure helpers `portal/src/lib/kpiMath.js` (+`.test.mjs`).

---

## File Structure

| File | Responsibility | Create/Modify |
| --- | --- | --- |
| `portal/src/lib/kpiMath.js` (+`.test.mjs`) | add `median`, `mean`, `formatMinutes`; extend `gapInfo` with `lowerIsBetter`/`unit` | Modify |
| `ghl-sync/migrations/008_first_contact.sql` | `ghl_first_contact` table | Create |
| `ghl-sync/src/ghl/conversations.js` (+`.test` for pure picker) | fetch + `pickFirstHumanContact(messages)` | Create |
| `ghl-sync/src/sync/computeFirstContact.js` | pick candidates, fetch, upsert, bounded+logged; backfill entry | Create |
| `ghl-sync/src/sync/deltaSync.js` | register the compute step | Modify |
| `auth/src/routes/reports.js` | `GET /reports/speed-to-lead` | Modify |
| `portal/src/lib/api.js` | `getSpeedToLead(params, options)` | Modify |
| `portal/src/components/reports/KpiReport.jsx` | generalized KPI model + speed KPI | Modify |
| `portal/src/components/admin/KpiGoalsAdmin.jsx` | Speed to Lead goal (min) field | Modify |
| `portal/src/lib/reportInfo.js` | Speed to Lead copy | Modify |

---

## Task 1: Pure helpers — median/mean/formatMinutes + gapInfo lowerIsBetter (TDD)

**Files:** Modify `portal/src/lib/kpiMath.js`, `portal/src/lib/kpiMath.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to `portal/src/lib/kpiMath.test.mjs` (and add the new names to the existing `import { ... } from './kpiMath.js'` line: `median, mean, formatMinutes`):

```js
test('median handles odd, even, empty', () => {
  assert.equal(median([5]), 5)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(median([]), null)
})

test('mean handles values and empty', () => {
  assert.equal(mean([2, 4, 6]), 4)
  assert.equal(mean([]), null)
})

test('formatMinutes renders compact durations', () => {
  assert.equal(formatMinutes(null), 'n/a')
  assert.equal(formatMinutes(0), '0m')
  assert.equal(formatMinutes(8), '8m')
  assert.equal(formatMinutes(63), '1h 3m')
  assert.equal(formatMinutes(120), '2h 0m')
})

test('gapInfo lowerIsBetter: under goal is good, over is bad', () => {
  assert.deepEqual(gapInfo(5, 10, { lowerIsBetter: true, unit: 'm' }), { diff: -5, tone: 'above', text: '5m under goal' })
  assert.deepEqual(gapInfo(15, 10, { lowerIsBetter: true, unit: 'm' }), { diff: 5, tone: 'below', text: '5m over goal' })
  assert.deepEqual(gapInfo(10, 10, { lowerIsBetter: true, unit: 'm' }), { diff: 0, tone: 'above', text: 'Goal met' })
})

test('gapInfo default (percent, higher better) unchanged', () => {
  assert.deepEqual(gapInfo(70, 65), { diff: 5, tone: 'above', text: '+5% above goal' })
  assert.deepEqual(gapInfo(58, 65), { diff: -7, tone: 'below', text: '-7% below goal' })
})
```

- [ ] **Step 2: Run, expect fail**

Run: `node --test portal/src/lib/kpiMath.test.mjs`
Expected: FAIL (`median`/`mean`/`formatMinutes` not exported; gapInfo opts unsupported).

- [ ] **Step 3: Implement**

In `portal/src/lib/kpiMath.js`, replace the existing `gapInfo` with this options-aware version (defaults preserve current behavior):

```js
// Compares an actual value to a goal. Returns null if either is missing.
// opts.lowerIsBetter (default false) flips which side is "good".
// opts.unit (default '%') is appended to the gap text.
export function gapInfo(actual, goal, opts = {}) {
  const { lowerIsBetter = false, unit = '%' } = opts
  if (actual == null || goal == null || goal === '' || Number.isNaN(Number(goal))) {
    return null
  }
  const g = Number(goal)
  const diff = actual - g
  if (diff === 0) return { diff: 0, tone: 'above', text: 'Goal met' }
  if (!lowerIsBetter) {
    if (diff > 0) return { diff, tone: 'above', text: `+${diff}${unit} above goal` }
    return { diff, tone: 'below', text: `${diff}${unit} below goal` }
  }
  if (diff < 0) return { diff, tone: 'above', text: `${Math.abs(diff)}${unit} under goal` }
  return { diff, tone: 'below', text: `${diff}${unit} over goal` }
}
```

Append these new exports at the end of the file:

```js
// Median of a numeric array. Returns null for empty input.
export function median(nums) {
  const xs = (nums || []).filter(n => n != null).slice().sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

// Arithmetic mean of a numeric array. Returns null for empty input.
export function mean(nums) {
  const xs = (nums || []).filter(n => n != null)
  if (xs.length === 0) return null
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
}

// Compact duration label for minute counts. null -> 'n/a'.
export function formatMinutes(min) {
  if (min == null) return 'n/a'
  const m = Math.round(min)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
```

- [ ] **Step 4: Run, expect pass**

Run: `node --test portal/src/lib/kpiMath.test.mjs`
Expected: PASS (all prior + new tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/kpiMath.js portal/src/lib/kpiMath.test.mjs
git commit -m "feat(portal): kpiMath median/mean/formatMinutes + gapInfo lowerIsBetter"
```

---

## Task 2: Migration — `ghl_first_contact` table

**Files:** Create `ghl-sync/migrations/008_first_contact.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Speed to Lead: first human outbound contact per Membership-pipeline opportunity.
CREATE TABLE IF NOT EXISTS ghl_first_contact (
  opportunity_id          TEXT PRIMARY KEY REFERENCES ghl_opportunities_v2(id),
  contact_id              TEXT,
  location_id             TEXT NOT NULL,
  opportunity_created_at  TIMESTAMPTZ,
  first_human_contact_at  TIMESTAMPTZ,
  first_contact_kind      TEXT,            -- 'sms' | 'call'
  checked_at              TIMESTAMPTZ DEFAULT now(),
  resolved                BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_first_contact_location ON ghl_first_contact(location_id);
CREATE INDEX IF NOT EXISTS idx_first_contact_oppcreated ON ghl_first_contact(opportunity_created_at);
CREATE INDEX IF NOT EXISTS idx_first_contact_unresolved ON ghl_first_contact(resolved) WHERE resolved = false;
```

- [ ] **Step 2: Apply to Supabase**

Apply via the project's normal migration path (the same way `007_referral_rewards.sql` was applied — run against the Supabase Postgres). Confirm the table exists:
Run (psql or Supabase SQL editor): `SELECT to_regclass('public.ghl_first_contact');`
Expected: returns `ghl_first_contact` (not null).

- [ ] **Step 3: Commit**

```bash
git add ghl-sync/migrations/008_first_contact.sql
git commit -m "feat(ghl-sync): ghl_first_contact table for Speed to Lead"
```

---

## Task 3: Conversations fetcher + pure picker (TDD for the picker)

**Files:** Create `ghl-sync/src/ghl/conversations.js`, `ghl-sync/src/ghl/conversations.test.mjs`

- [ ] **Step 1: Failing test for the pure picker**

Create `ghl-sync/src/ghl/conversations.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickFirstHumanContact } from './conversations.js'

const M = (o) => ({ direction: 'outbound', source: 'app', messageType: 'TYPE_SMS', ...o })

test('picks earliest outbound app SMS/call, ignores workflow/inbound/email', () => {
  const msgs = [
    M({ dateAdded: '2026-06-01T10:00:00Z', source: 'workflow' }),        // auto-text: ignore
    M({ dateAdded: '2026-06-01T10:05:00Z', direction: 'inbound' }),       // inbound: ignore
    M({ dateAdded: '2026-06-01T10:30:00Z', messageType: 'TYPE_EMAIL' }),  // email: ignore
    M({ dateAdded: '2026-06-01T11:00:00Z' }),                             // human SMS  <-- winner
    M({ dateAdded: '2026-06-01T12:00:00Z', messageType: 'TYPE_CALL' }),   // later call
  ]
  const r = pickFirstHumanContact(msgs)
  assert.equal(r.at, '2026-06-01T11:00:00Z')
  assert.equal(r.kind, 'sms')
})

test('recognizes a human call', () => {
  const r = pickFirstHumanContact([M({ dateAdded: '2026-06-02T09:00:00Z', messageType: 'TYPE_CALL' })])
  assert.equal(r.kind, 'call')
})

test('returns null when no human SMS/call', () => {
  assert.equal(pickFirstHumanContact([M({ source: 'workflow' }), M({ direction: 'inbound' })]), null)
  assert.equal(pickFirstHumanContact([]), null)
})
```

- [ ] **Step 2: Run, expect fail**

Run: `node --test ghl-sync/src/ghl/conversations.test.mjs`
Expected: FAIL (module/function missing).

Note: `conversations.js` is CommonJS for runtime (`require`), but the test imports it as ESM. To support both, export the pure picker via `module.exports` AND make the file importable by `node --test` — simplest: write `conversations.js` as CommonJS and have the `.test.mjs` import the named export through interop. Node ESM `import { pickFirstHumanContact } from './conversations.js'` works against a CommonJS module's `module.exports.pickFirstHumanContact` only via default interop. **To avoid interop friction, put the pure picker in its own CommonJS file `ghl-sync/src/ghl/firstContactPick.js` and import it with `import pkg from './firstContactPick.js'; const { pickFirstHumanContact } = pkg`.** Update the test import accordingly:

```js
import pkg from './firstContactPick.js'
const { pickFirstHumanContact } = pkg
```

So: create `ghl-sync/src/ghl/firstContactPick.js` (pure, CommonJS) and have `conversations.js` require it. Rename the test to `firstContactPick.test.mjs`.

- [ ] **Step 3: Implement the pure picker**

Create `ghl-sync/src/ghl/firstContactPick.js`:

```js
// Pure selection of the first HUMAN outbound contact from a list of GHL messages.
// Human = outbound + source 'app' (manual), SMS or call. Ignores 'workflow'
// automation, inbound, and non-SMS/call types. Returns { at, kind } or null.
function pickFirstHumanContact(messages) {
  let best = null
  for (const m of (messages || [])) {
    if (m.direction !== 'outbound') continue
    if (m.source !== 'app') continue
    const isSms = m.messageType === 'TYPE_SMS'
    const isCall = m.messageType === 'TYPE_CALL'
    if (!isSms && !isCall) continue
    if (!m.dateAdded) continue
    const t = Date.parse(m.dateAdded)
    if (Number.isNaN(t)) continue
    if (best === null || t < best.t) {
      best = { t, at: m.dateAdded, kind: isCall ? 'call' : 'sms' }
    }
  }
  return best ? { at: best.at, kind: best.kind } : null
}

module.exports = { pickFirstHumanContact }
```

- [ ] **Step 4: Run, expect pass**

Run: `node --test ghl-sync/src/ghl/firstContactPick.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement the fetcher**

Create `ghl-sync/src/ghl/conversations.js`:

```js
const { get } = require('./client');
const { pickFirstHumanContact } = require('./firstContactPick');

// Find the first human outbound contact (manual SMS/call) for one contact.
// Returns { at, kind } or null. Throws on hard API errors (caller catches).
async function fetchFirstHumanContact(locationId, apiKey, contactId) {
  // 1) find the contact's conversation(s)
  const search = await get('/conversations/search', { locationId, contactId, limit: 20 }, apiKey);
  const convos = search?.conversations || [];
  let messages = [];
  // 2) pull messages from each conversation (usually one) and merge
  for (const c of convos) {
    const mres = await get(`/conversations/${c.id}/messages`, {}, apiKey);
    const msgs = mres?.messages?.messages || mres?.messages || [];
    messages = messages.concat(msgs);
  }
  return pickFirstHumanContact(messages);
}

module.exports = { fetchFirstHumanContact, pickFirstHumanContact };
```

- [ ] **Step 6: Commit**

```bash
git add ghl-sync/src/ghl/firstContactPick.js ghl-sync/src/ghl/firstContactPick.test.mjs ghl-sync/src/ghl/conversations.js
git commit -m "feat(ghl-sync): conversations fetcher + first-human-contact picker (source='app')"
```

---

## Task 4: Compute step + delta registration + backfill entry

**Files:** Create `ghl-sync/src/sync/computeFirstContact.js`; Modify `ghl-sync/src/sync/deltaSync.js`

- [ ] **Step 1: Implement the compute step**

Create `ghl-sync/src/sync/computeFirstContact.js`:

```js
const supabase = require('../db/supabase');
const { fetchFirstHumanContact } = require('../ghl/conversations');

const RETRY_WINDOW_DAYS = 30;
const MEMBERSHIP_PIPELINE_NAME = 'Membership';
const PER_RUN_CAP = parseInt(process.env.SPEED_TO_LEAD_CAP || '300', 10);

// Returns Membership-pipeline opportunities for a location that still need a
// first-contact check: no row yet, OR unresolved within the retry window.
async function selectCandidates(locationId) {
  const cutoff = new Date(Date.now() - RETRY_WINDOW_DAYS * 86400000).toISOString();
  // Opportunities in the Membership pipeline with a contact.
  const { data: opps, error } = await supabase
    .from('ghl_opportunities_v2')
    .select('id, contact_id, created_at_ghl, location_id')
    .eq('location_id', locationId)
    .eq('pipeline_name', MEMBERSHIP_PIPELINE_NAME)
    .not('contact_id', 'is', null)
    .gte('created_at_ghl', cutoff)
    .order('created_at_ghl', { ascending: false })
    .limit(PER_RUN_CAP * 3);
  if (error) throw error;
  // Existing rows to know what's resolved.
  const ids = (opps || []).map(o => o.id);
  if (ids.length === 0) return [];
  const { data: rows } = await supabase
    .from('ghl_first_contact')
    .select('opportunity_id, resolved')
    .in('opportunity_id', ids);
  const resolved = new Set((rows || []).filter(r => r.resolved).map(r => r.opportunity_id));
  return (opps || []).filter(o => !resolved.has(o.id)).slice(0, PER_RUN_CAP);
}

async function computeFirstContact(location) {
  const candidates = await selectCandidates(location.id);
  let resolvedCount = 0;
  const errors = [];
  for (const opp of candidates) {
    try {
      const found = await fetchFirstHumanContact(location.id, location.apiKey, opp.contact_id);
      const row = {
        opportunity_id: opp.id,
        contact_id: opp.contact_id,
        location_id: location.id,
        opportunity_created_at: opp.created_at_ghl,
        first_human_contact_at: found ? found.at : null,
        first_contact_kind: found ? found.kind : null,
        checked_at: new Date().toISOString(),
        resolved: !!found,
      };
      const { error } = await supabase.from('ghl_first_contact').upsert(row, { onConflict: 'opportunity_id' });
      if (error) { errors.push({ id: opp.id, error: error.message }); continue; }
      if (found) resolvedCount++;
    } catch (err) {
      errors.push({ id: opp.id, error: err.message });
    }
  }
  return { checked: candidates.length, resolved: resolvedCount, errors };
}

module.exports = { computeFirstContact, selectCandidates };
```

- [ ] **Step 2: Register in deltaSync**

In `ghl-sync/src/sync/deltaSync.js`: add the require near the other requires:
```js
const { computeFirstContact } = require('./computeFirstContact');
```
Inside the `for (const location of LOCATIONS)` loop, after the opportunities block (after its `writeSyncLog` ~line 79), add:
```js
    // Speed to Lead: first human contact for Membership-pipeline opps.
    let fcStart = new Date().toISOString();
    try {
      const fc = await computeFirstContact(location);
      console.log(`[Delta] ${location.name}: first-contact checked ${fc.checked}, resolved ${fc.resolved}`);
      await writeSyncLog({ syncType: 'delta', entity: 'first_contact', locationId: location.id, recordsFetched: fc.checked, recordsUpserted: fc.resolved, errors: fc.errors, startedAt: fcStart });
    } catch (err) {
      console.error(`[Delta] ${location.name} first-contact failed:`, err.message);
      await writeSyncLog({ syncType: 'delta', entity: 'first_contact', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: fcStart });
    }
```

- [ ] **Step 3: Verify it loads (syntax/runtime)**

Run: `node -e "require('./ghl-sync/src/sync/computeFirstContact'); require('./ghl-sync/src/sync/deltaSync'); console.log('ok')"`
Expected: prints `ok` (no syntax/require errors). (Do not trigger a full sync here.)

- [ ] **Step 4: Commit**

```bash
git add ghl-sync/src/sync/computeFirstContact.js ghl-sync/src/sync/deltaSync.js
git commit -m "feat(ghl-sync): compute first human contact in delta cycle (Membership pipeline, bounded)"
```

---

## Task 5: Report route `GET /reports/speed-to-lead`

**Files:** Modify `auth/src/routes/reports.js`

- [ ] **Step 1: Add the route**

Find the helpers (`resolveLocationFilter`, `dateToMs`, `applyDateRange`, `applyLocationFilter`) and an existing `router.get('/club-health', ...)`-style route to mirror. Add a new route (place it near the other report routes, before `module.exports`):

```js
// GET /reports/speed-to-lead
// Query: start_date, end_date, location_slug. Median (+ mean) minutes from
// opportunity creation to first human contact, for opps created in range.
router.get('/speed-to-lead', async (req, res) => {
  const { start_date, end_date } = req.query
  try {
    const locationFilter = await resolveLocationFilter(req.query)
    const startMs = dateToMs(start_date, false)
    const endMs = dateToMs(end_date, true)

    let q = supabaseAdmin
      .from('ghl_first_contact')
      .select('opportunity_created_at, first_human_contact_at, location_id')
    q = applyLocationFilter(q, locationFilter)
    // opportunity_created_at is a timestamptz; filter by ISO bounds.
    if (startMs) q = q.gte('opportunity_created_at', new Date(Number(startMs)).toISOString())
    if (endMs) q = q.lte('opportunity_created_at', new Date(Number(endMs)).toISOString())

    const { data, error } = await q
    if (error) return res.status(500).json({ error: 'Failed to fetch speed to lead', detail: error.message })

    const rows = data || []
    const minutes = []
    let uncontacted = 0
    for (const r of rows) {
      if (!r.first_human_contact_at) { uncontacted++; continue }
      const delta = (new Date(r.first_human_contact_at) - new Date(r.opportunity_created_at)) / 60000
      minutes.push(Math.max(0, delta))
    }
    const sorted = minutes.slice().sort((a, b) => a - b)
    let med = null
    if (sorted.length) {
      const mid = Math.floor(sorted.length / 2)
      med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }
    const avg = minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : null

    res.json({
      median_minutes: med == null ? null : Math.round(med),
      mean_minutes: avg == null ? null : Math.round(avg),
      contacted_count: minutes.length,
      uncontacted_count: uncontacted,
      total_opportunities: rows.length,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
```

Note: confirm the exact helper names (`supabaseAdmin`, `resolveLocationFilter`, `dateToMs`, `applyLocationFilter`) match this file by reading them first; adjust to the real names. `applyLocationFilter` operates on the `location_id`/`location_slug` column the filter resolves — `ghl_first_contact` has `location_id`, so ensure `resolveLocationFilter` is asked to filter on `location_id` (mirror how `/club-health` or `/membership` filters `ghl_*` tables; if those use a `location_slug` view column, replicate that approach — e.g. resolve slugs to location IDs and use `.in('location_id', ids)`).

- [ ] **Step 2: Verify it loads**

Run: `node -e "require('./auth/src/routes/reports'); console.log('reports route ok')"`
Expected: `reports route ok` (no syntax errors).

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/reports.js
git commit -m "feat(auth): GET /reports/speed-to-lead (median + mean minutes to first human contact)"
```

---

## Task 6: Portal API helper

**Files:** Modify `portal/src/lib/api.js`

- [ ] **Step 1: Add helper** (mirror `getMembershipReport`)

```js
export async function getSpeedToLead(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/speed-to-lead' + (qs ? '?' + qs : ''), options)
}
```

- [ ] **Step 2: Build check**

Run: `cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat(portal): getSpeedToLead api helper"
```

---

## Task 7: Generalize KpiReport + add Speed to Lead KPI

**Files:** Modify `portal/src/components/reports/KpiReport.jsx`

This task makes each KPI declare its data `source`, `format`, and goal direction, fetches each distinct source once per location/period (and per trend month), and formats values accordingly.

- [ ] **Step 1: Imports + KPI_DEFS**

Update the kpiMath import to include the new helpers:
```js
import { pct, gapInfo, monthRangesBetween, median, formatMinutes } from '../../lib/kpiMath'
import { getMembershipReport, getAppSettings, getSpeedToLead } from '../../lib/api'
```

Extend `KPI_DEFS` so each def declares `source` ('membership' default) and optional `format`/`lowerIsBetter`, and add the speed KPI:
```js
export const KPI_DEFS = [
  { key: 'trial', label: 'Trial Conversion', goalKey: 'kpi_goal_trial', source: 'membership',
    derive: d => (d?.trial_conversion?.trial_started ? d.trial_conversion.rate : null) },
  { key: 'dayone', label: 'Day One Attachment', goalKey: 'kpi_goal_dayone', source: 'membership',
    derive: d => pct(d?.total_day_one_booked || 0, d?.total_memberships || 0) },
  { key: 'vip', label: 'VIP Collection Percentage', goalKey: 'kpi_goal_vip', source: 'membership',
    derive: d => pct(d?.total_vips || 0, d?.total_memberships || 0) },
  { key: 'speed', label: 'Speed to Lead', goalKey: 'kpi_goal_speed', source: 'speed',
    format: 'minutes', lowerIsBetter: true,
    derive: d => (d?.contacted_count ? d.median_minutes : null) },
]

// Distinct data sources used by the KPIs, with their fetchers.
const SOURCE_FETCHERS = {
  membership: (params, opts) => getMembershipReport(params, opts),
  speed: (params, opts) => getSpeedToLead(params, opts),
}
const DISTINCT_SOURCES = [...new Set(KPI_DEFS.map(d => d.source))]

// Formats a KPI value per its def.
function formatValue(def, v) {
  if (v == null) return 'n/a'
  return def.format === 'minutes' ? formatMinutes(v) : `${v}%`
}
function gapFor(def, value, goal) {
  return gapInfo(value, goal, { lowerIsBetter: !!def.lowerIsBetter, unit: def.format === 'minutes' ? 'm' : '%' })
}
function onTarget(def, value, goal) {
  if (value == null || goal == null) return false
  return def.lowerIsBetter ? value <= goal : value >= goal
}
```

- [ ] **Step 2: Multi-source fetch (current period + per-club + trend)**

The current code fetches one membership response into `data`. Change it to fetch a **map of sources** → response. Replace the combined-data state and effect so `data` becomes `dataBySource` (`{ membership: {...}, speed: {...} }`), and per-club becomes `perClub[slug] = { membership, speed }`. Concretely:

- State: rename `const [data, setData] = useState(null)` → `const [dataBySource, setDataBySource] = useState(null)`.
- Main effect: fetch all distinct sources in parallel:
```js
Promise.all([
  Promise.all(DISTINCT_SOURCES.map(s =>
    SOURCE_FETCHERS[s]({ start_date: startDate, end_date: endDate, location_slug: locationSlug })
      .then(r => [s, r]).catch(() => [s, null])
  )),
  getAppSettings('kpi_goal_'),
]).then(([pairs, goalMap]) => {
  if (cancelled) return
  setDataBySource(Object.fromEntries(pairs))
  setGoals(goalMap || {})
})
```
- Per-club effect: for each club fetch all sources:
```js
Promise.all(clubs.map(async slug => {
  const pairs = await Promise.all(DISTINCT_SOURCES.map(s =>
    SOURCE_FETCHERS[s]({ start_date: startDate, end_date: endDate, location_slug: slug })
      .then(r => [s, r]).catch(() => [s, null])
  ))
  return [slug, Object.fromEntries(pairs)]
})).then(results => { if (!cancelled) setPerClub(Object.fromEntries(results)) })
```
- Trend effect (single club): per month, fetch all sources, derive each KPI from its source:
```js
const perMonth = await Promise.all(ranges.map(async r => {
  const pairs = await Promise.all(DISTINCT_SOURCES.map(s =>
    SOURCE_FETCHERS[s]({ start_date: r.start, end_date: r.end, location_slug: locationSlug })
      .then(x => [s, x]).catch(() => [s, null])
  ))
  return { range: r, bySource: Object.fromEntries(pairs) }
}))
// then: byKey[def.key] = perMonth.map(({range, bySource}) => ({ key: range.key, label: range.label, value: def.derive(bySource[def.source]) }))
```

- [ ] **Step 3: Use source/format/gap in render**

Where a tile currently does `const value = def.derive(data)`, use `def.derive(dataBySource?.[def.source])`. Replace `${value}%` displays with `formatValue(def, value)`. Replace `gapInfo(value, singleGoal)` with `gapFor(def, value, singleGoal)`. In the multi-club counter, replace the `a >= g` check with `onTarget(def, a, g)`, computing `a = def.derive(perClub[slug]?.[def.source])`. In `PerClubGoalTable`, compute `a = perClub ? def.derive(perClub[slug]?.[def.source]) : null`, render actual via `formatValue(def, a)`, goal via `def.format === 'minutes' ? formatMinutes(g) : (g==null?'—':g+'%')`, and Hit/Missed via `onTarget(def, a, g)`.

- [ ] **Step 4: Trend chart formatting (minutes)**

`KpiTrendChart` currently labels points `${p.value}%`. Pass the def (or a `format`) into the chart and label points/goal with `formatValue`-style output: for minutes use `formatMinutes(p.value)`; for percent keep `${p.value}%`. Add a `format` prop to `KpiTrendChart` and use it for point labels and the goal legend (`Goal {formatMinutes(goal)}` vs `Goal {goal}%`). The y-axis numeric ticks can stay raw numbers (minutes or percent) — acceptable.

- [ ] **Step 5: Build check**

Run: `cd portal && npm run build`
Expected: build succeeds, no errors. Grep to confirm no remaining bare `def.derive(data)` or `${value}%` for the speed tile.

- [ ] **Step 6: Commit**

```bash
git add portal/src/components/reports/KpiReport.jsx
git commit -m "feat(portal): generalize KPI model (source/format/lowerIsBetter) + Speed to Lead tile"
```

---

## Task 8: Admin goal field + report info copy

**Files:** Modify `portal/src/components/admin/KpiGoalsAdmin.jsx`, `portal/src/lib/reportInfo.js`

- [ ] **Step 1: Add the goal field**

In `KpiGoalsAdmin.jsx`, append to `GOAL_FIELDS`:
```js
  { prefix: 'kpi_goal_speed', label: 'Speed to Lead Goal (min)' },
```
(The grid is `grid-cols-3`; with 4 fields it wraps to two rows — fine. Optionally change to `grid-cols-2` for even layout.)

- [ ] **Step 2: Update KPIs report info**

In `portal/src/lib/reportInfo.js`, in the `kpis` entry, add a section describing Speed to Lead:
```js
      {
        heading: 'Speed to Lead',
        body:
          'Median minutes from when a Membership-pipeline lead is created to the first human outbound contact (a manually-sent text or a call). Automated texts are ignored, so this reflects real staff response time. Lower is better; the goal is a maximum number of minutes.',
      },
```
Update the "What this is" line to mention four metrics instead of three.

- [ ] **Step 3: Build check**

Run: `cd portal && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/admin/KpiGoalsAdmin.jsx portal/src/lib/reportInfo.js
git commit -m "feat(portal): Speed to Lead goal field + report info copy"
```

---

## Task 9: End-to-end verification + bounded live backfill

**Files:** none (verification)

- [ ] **Step 1: Pure tests**

Run: `node --test portal/src/lib/kpiMath.test.mjs ghl-sync/src/ghl/firstContactPick.test.mjs`
Expected: all pass.

- [ ] **Step 2: Builds / loads**

Run: `cd portal && npm run build` (success), and
`node -e "require('./ghl-sync/src/sync/deltaSync'); require('./auth/src/routes/reports'); console.log('ok')"` (prints ok).

- [ ] **Step 3: Bounded live backfill smoke test**

With `ghl-sync/.env` creds, run a one-location, low-cap compute to confirm the API path works end to end and populates rows:
```bash
cd ghl-sync && SPEED_TO_LEAD_CAP=15 node -e "require('dotenv').config(); const L=require('./src/config/locations'); require('./src/sync/computeFirstContact').computeFirstContact(L.find(x=>x.slug==='salem')).then(r=>console.log(JSON.stringify(r))).catch(e=>console.log('ERR',e.message))"
```
Expected: prints `{ checked: N, resolved: M, errors: [] }` with N ≤ 15. Then verify rows: `SELECT count(*), count(first_human_contact_at) FROM ghl_first_contact;` (some resolved). Spot-check one opportunity's computed minutes against GHL (confirm the auto-text was ignored and a manual SMS/call was chosen).

- [ ] **Step 4: Endpoint smoke test**

Hit `GET /reports/speed-to-lead?location_slug=salem&start_date=<recent>&end_date=<today>` against a local/staging auth API (or add a tiny node harness) and confirm it returns `median_minutes`, `mean_minutes`, counts.

- [ ] **Step 5: Manual UI pass (human)**

`cd portal && npm run dev`, KPIs report as admin: confirm a 4th tile "Speed to Lead" shows median (e.g. `12m`), goal in minutes, gap badge inverted (under goal = green), trend in minutes (single club), per-club Hit/Missed table (All). Set a Speed to Lead goal in the KPI Goals admin and confirm it reflects.

- [ ] **Step 6: Codex review (project convention) + address findings**

Run Codex CLI read-only over `git diff master...feat/speed-to-lead`; fix any correctness findings; commit.

---

## Self-Review Notes (author)

- **Spec coverage:** detection via `source:'app'` (Task 3 picker + tests), Membership pipeline/New Lead scoping (Task 4 `selectCandidates`), `ghl_first_contact` table (Task 2), bounded compute-once in delta (Task 4), `/reports/speed-to-lead` median+mean+counts (Task 5), duration/lower-is-better KPI with formatting + trend + multi-club (Tasks 1, 7), goal storage `kpi_goal_speed_<slug>` + admin field (Task 8), reportInfo (Task 8), backfill (Task 9 Step 3). Covered.
- **Type/name consistency:** `gapInfo(actual, goal, {lowerIsBetter, unit})` defined in Task 1 and used in Task 7; `kpi_goal_speed` matches between KPI_DEFS (Task 7) and GOAL_FIELDS (Task 8); `getSpeedToLead` defined Task 6, used Task 7; `ghl_first_contact` columns match across Tasks 2/4/5; `pickFirstHumanContact` defined Task 3, used by fetcher Task 3 + tested.
- **Known adjustables flagged for implementer:** exact `auth` helper names (`supabaseAdmin`/`resolveLocationFilter`/`applyLocationFilter`) and how `ghl_*` routes filter location (slug-view vs `location_id`) must be matched to the real file in Task 5; the ESM/CommonJS split for the testable picker (Task 3) is handled by the separate `firstContactPick.js`.
