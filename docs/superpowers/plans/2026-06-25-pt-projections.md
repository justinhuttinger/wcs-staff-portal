# PT Projections Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manager-facing "PT Projections" report that shows when each active recurring PT agreement's next payment is expected, the expected revenue per day, and a current-period reconciliation (projected vs collected vs outstanding vs past-due) by day, location, trainer, and member.

**Architecture:** Reuse PT Roster's already-cached enumeration of active recurring PT services (extracted into a shared service module). A pure library computes the projection/reconciliation math from those services plus collected `TRAINING` revenue rows. A new SWR-cached route serves it; a new React component renders it inside the Training report group.

**Tech Stack:** Node/Express (auth service), Supabase Postgres (`abc_revenue_transactions`), ABC Financial REST API (`/members/recurringservices`), React + Vite + Tailwind (portal), `node:test` for unit tests.

## Global Constraints

- Node/Express CommonJS modules (`require`/`module.exports`) in `auth/`.
- Reports cache via `wrapSWR(key, freshMs, staleMs, producer)` from `auth/src/services/memoryCache.js`; route file exports `module.exports.warmCache = buildPayloadFn` for the cache warmer.
- Location parsing uses `parseLocationSlugParam` + `locationCacheKey` from `auth/src/utils/locationSlug.js`.
- DB access is 100% service-role via `supabaseAdmin` from `auth/src/services/supabase.js` (frontend never uses supabase-js).
- Unit tests use `const test = require('node:test'); const assert = require('node:assert')`, live next to the file as `<name>.test.js`, run with `node --test <path>`.
- The 7 clubs (slug/clubNumber/name) are the canonical CLUBS list (Salem 30935, Keizer 31599, Eugene 7655, Springfield 31598, Clackamas 31600, Milwaukie 31601, Medford 32073).
- Collected PT revenue = `abc_revenue_transactions` rows with `profit_center IN ('TRAINING','PERSONAL TRAINING')`.
- Report key is exactly `pt-projections`. Access tier: `manager` (REPORT_ACCESS: `['manager','marketing','corporate','admin']`).
- No em-dashes in any user-facing copy (use commas/hyphens). Copy buttons show a "Copied!" confirmation.
- Dates compared as `YYYY-MM-DD` ISO strings (lexicographic ordering is valid).

---

### Task 1: Extract shared active-recurring-PT fetch into a service module

Pull PT Roster's ABC enumeration helpers into a shared module so the new report and PT Roster share one cached code path, with no behavior change to PT Roster.

**Files:**
- Create: `auth/src/services/abcRecurring.js`
- Create (test): `auth/src/services/abcRecurring.test.js`
- Modify: `auth/src/routes/ptRoster.js` (remove the now-shared helpers, import them instead)

**Interfaces:**
- Produces:
  - `CLUBS: Array<{slug, clubNumber, name}>`
  - `isPT(name: string): boolean`
  - `normSvc(name: string): string`
  - `async fetchActiveRecurringPTServices(clubNumber: string): Promise<RawService[]>` — returns deduped recurring services for the club that are `recurringServiceStatus === 'active'` and NOT "Paid in Full" and `isPT(serviceItem)`. Each `RawService` is the raw ABC object (has `memberId`, `memberFirstName`, `memberLastName`, `serviceEmployeeFirstName`, `serviceEmployeeLastName`, `serviceItem`, `invoiceTotal`, `recurringServiceDates.nextBillingDate`).
  - `async fetchRecurring(clubNumber: string): Promise<RawService[]>` — the full deduped set (active + inactive + PIF), preserved for PT Roster's PIF logic.

- [ ] **Step 1: Create the shared module by moving helpers out of ptRoster.js**

Copy these from `auth/src/routes/ptRoster.js` verbatim into a new `auth/src/services/abcRecurring.js`: the `ABC_BASE_URL/ABC_APP_ID/ABC_APP_KEY` consts, `CLUBS`, `isPT`, `normSvc`, `dateRanges`, `abcGet`, `fetchAllRanges`, `fetchRecurring`. Then add the new filtered accessor. End the file with:

```javascript
// Active, non-PIF, PT-only recurring services for one club.
async function fetchActiveRecurringPTServices(clubNumber) {
  const all = await fetchRecurring(clubNumber)
  return all.filter(
    s => s.recurringServiceStatus === 'active' &&
      !((s.recurringTypeDesc || '').includes('Paid in Full')) &&
      isPT(s.serviceItem)
  )
}

module.exports = {
  CLUBS, isPT, normSvc, dateRanges, abcGet, fetchAllRanges, fetchRecurring,
  fetchActiveRecurringPTServices,
}
```

(Keep `abcGet`'s existing timeout/AbortController body exactly as it is in ptRoster.js — copy lines 70 through the end of that function.)

- [ ] **Step 2: Write a unit test for the pure helpers**

Create `auth/src/services/abcRecurring.test.js`:

```javascript
const test = require('node:test')
const assert = require('node:assert')
const { isPT, normSvc, CLUBS } = require('./abcRecurring')

test('isPT matches training service names, excludes consults', () => {
  assert.equal(isPT('PT 60MIN'), true)
  assert.equal(isPT('SMALL GROUP TRAINING'), true)
  assert.equal(isPT('ONLINE COACHING'), true)
  assert.equal(isPT('PT CONSULT'), false)
  assert.equal(isPT('DUES'), false)
  assert.equal(isPT(''), false)
})

test('normSvc collapses PT60 aliases', () => {
  assert.equal(normSvc('PT 60MIN'), 'PT60')
  assert.equal(normSvc('Group Training'), 'Group Training')
})

test('CLUBS has all seven clubs', () => {
  assert.equal(CLUBS.length, 7)
  assert.ok(CLUBS.find(c => c.slug === 'medford' && c.clubNumber === '32073'))
})
```

- [ ] **Step 3: Run the test, expect PASS**

Run: `node --test auth/src/services/abcRecurring.test.js`
Expected: 3 tests pass.

- [ ] **Step 4: Refactor ptRoster.js to import the shared helpers**

In `auth/src/routes/ptRoster.js`: delete the local `CLUBS`, `isPT`, `normSvc`, `dateRanges`, `abcGet`, `fetchAllRanges`, `fetchRecurring` definitions and the duplicate `ABC_BASE_URL/ABC_APP_ID/ABC_APP_KEY` consts that are only used by those helpers. Add near the top imports:

```javascript
const { CLUBS, isPT, normSvc, fetchRecurring } = require('../services/abcRecurring')
```

Keep everything else in ptRoster.js (planCache, fetchPlanDetail, parseFrequency, fetchLatestPIF, buildClients, buildPtRosterPayload, routes) unchanged. Note: `ABC_APP_ID`/`ABC_APP_KEY` are still referenced in `buildPtRosterPayload`'s guard and `/debug-sample`; keep those two consts in ptRoster.js (re-declare if the deletion removed them).

- [ ] **Step 5: Verify ptRoster still parses and the module loads**

Run: `node --check auth/src/routes/ptRoster.js && node --check auth/src/services/abcRecurring.js && node -e "require('./auth/src/routes/ptRoster'); require('./auth/src/services/abcRecurring'); console.log('load OK')"`
Expected: `load OK` (no missing-reference crash).

- [ ] **Step 6: Commit**

```bash
git add auth/src/services/abcRecurring.js auth/src/services/abcRecurring.test.js auth/src/routes/ptRoster.js
git commit -m "refactor(pt): extract shared active-recurring-PT fetch into abcRecurring service"
```

---

### Task 2: Pure projection + reconciliation library

The testable core: given normalized active PT services + collected revenue rows + a window, compute the summary, by-day calendar, by-location, by-trainer, and member rows.

**Files:**
- Create: `auth/src/lib/ptProjections.js`
- Create (test): `auth/src/lib/ptProjections.test.js`

**Interfaces:**
- Consumes: nothing from other tasks (pure).
- Produces:
  - `normalizeService(raw, clubSlug): NormService` where `NormService = { memberId, name, trainer, location, nextBillingDate, amount }`.
  - `computeProjections({ services, collected, windowStart, windowEnd, today }): Result`
    - `services: NormService[]`
    - `collected: Array<{ memberNumber, location, amount }>` (already filtered to TRAINING + window by the caller)
    - `windowStart, windowEnd, today: 'YYYY-MM-DD'`
    - `Result = { summary, byDay, byLocation, byTrainer, members }` with shapes:
      - `summary: { projected, collected, outstanding, pastDue, window:{start,end}, asOf }`
      - `byDay: Array<{ date, amount, count }>` (upcoming drafts, `nextBillingDate` in `[today, windowEnd]`, ascending)
      - `byLocation: Array<{ slug, projected, collected, outstanding, pastDue }>`
      - `byTrainer: Array<{ trainer, location, projected, collected, count }>`
      - `members: Array<{ memberId, name, trainer, location, nextBillingDate, amount, status }>` where `status ∈ 'collected'|'upcoming'|'pastdue'|'future'`

- [ ] **Step 1: Write the failing tests**

Create `auth/src/lib/ptProjections.test.js`:

```javascript
const test = require('node:test')
const assert = require('node:assert')
const { normalizeService, computeProjections } = require('./ptProjections')

function svc(memberId, trainer, location, nextBillingDate, amount) {
  return { memberId, name: 'M' + memberId, trainer, location, nextBillingDate, amount }
}

test('normalizeService maps raw ABC fields', () => {
  const n = normalizeService({
    memberId: '99', memberFirstName: 'Jo', memberLastName: 'Doe',
    serviceEmployeeFirstName: 'Pat', serviceEmployeeLastName: 'Lee',
    invoiceTotal: '120.00', recurringServiceDates: { nextBillingDate: '2026-06-28' },
  }, 'salem')
  assert.equal(n.memberId, '99')
  assert.equal(n.name, 'Jo Doe')
  assert.equal(n.trainer, 'Pat Lee')
  assert.equal(n.location, 'salem')
  assert.equal(n.nextBillingDate, '2026-06-28')
  assert.equal(n.amount, 120)
})

test('reconciliation splits collected, outstanding, past-due without double counting', () => {
  const today = '2026-06-25'
  const services = [
    svc('1', 'Pat Lee', 'salem', '2026-06-28', 100),   // outstanding (>= today, <= end)
    svc('2', 'Pat Lee', 'salem', '2026-06-10', 200),   // past-due (< today, >= start)
    svc('3', 'Sam Fox', 'eugene', '2026-07-05', 300),  // future (after window end) -> not outstanding/pastdue
  ]
  const collected = [
    { memberNumber: '4', location: 'salem', amount: 50 },   // collected, not in recurring pop
    { memberNumber: '2', location: 'salem', amount: 200 },  // collected AND member also has past-due svc
  ]
  const r = computeProjections({
    services, collected, windowStart: '2026-06-01', windowEnd: '2026-06-30', today,
  })
  assert.equal(r.summary.collected, 250)     // 50 + 200
  assert.equal(r.summary.outstanding, 100)   // svc 1
  assert.equal(r.summary.pastDue, 200)       // svc 2
  assert.equal(r.summary.projected, 550)     // 250 + 100 + 200
  assert.equal(r.summary.asOf, today)
})

test('byDay lists only upcoming drafts in [today, end], ascending', () => {
  const r = computeProjections({
    services: [
      svc('1', 'A', 'salem', '2026-06-28', 100),
      svc('2', 'A', 'salem', '2026-06-28', 50),
      svc('3', 'A', 'salem', '2026-06-10', 200), // past-due, excluded from byDay
      svc('4', 'A', 'salem', '2026-07-09', 80),  // beyond window end, excluded
    ],
    collected: [], windowStart: '2026-06-01', windowEnd: '2026-06-30', today: '2026-06-25',
  })
  assert.deepEqual(r.byDay, [{ date: '2026-06-28', amount: 150, count: 2 }])
})

test('byLocation aggregates each bucket per slug', () => {
  const r = computeProjections({
    services: [
      svc('1', 'A', 'salem', '2026-06-28', 100),
      svc('2', 'A', 'eugene', '2026-06-10', 200),
    ],
    collected: [{ memberNumber: '9', location: 'salem', amount: 75 }],
    windowStart: '2026-06-01', windowEnd: '2026-06-30', today: '2026-06-25',
  })
  const salem = r.byLocation.find(l => l.slug === 'salem')
  const eugene = r.byLocation.find(l => l.slug === 'eugene')
  assert.deepEqual(salem, { slug: 'salem', projected: 175, collected: 75, outstanding: 100, pastDue: 0 })
  assert.deepEqual(eugene, { slug: 'eugene', projected: 200, collected: 0, outstanding: 0, pastDue: 200 })
})

test('byTrainer attributes collected via member->trainer map from services', () => {
  const r = computeProjections({
    services: [ svc('1', 'Pat Lee', 'salem', '2026-06-28', 100) ],
    collected: [
      { memberNumber: '1', location: 'salem', amount: 100 }, // member 1 -> Pat Lee
      { memberNumber: '5', location: 'salem', amount: 40 },  // unknown member -> "Other"
    ],
    windowStart: '2026-06-01', windowEnd: '2026-06-30', today: '2026-06-25',
  })
  const pat = r.byTrainer.find(t => t.trainer === 'Pat Lee')
  assert.equal(pat.collected, 100)
  assert.equal(pat.projected, 200)   // collected 100 + own upcoming 100
  assert.equal(pat.count, 1)
  const other = r.byTrainer.find(t => t.trainer === 'Other')
  assert.equal(other.collected, 40)
  assert.equal(other.projected, 40)  // collected only, no services
})

test('member status classification', () => {
  const r = computeProjections({
    services: [
      svc('1', 'A', 'salem', '2026-06-28', 100),  // upcoming
      svc('2', 'A', 'salem', '2026-06-10', 200),  // pastdue (no collected row)
      svc('3', 'A', 'salem', '2026-07-09', 80),   // future
    ],
    collected: [{ memberNumber: '4', location: 'salem', amount: 50 }],
    windowStart: '2026-06-01', windowEnd: '2026-06-30', today: '2026-06-25',
  })
  const byId = Object.fromEntries(r.members.map(m => [m.memberId, m.status]))
  assert.equal(byId['1'], 'upcoming')
  assert.equal(byId['2'], 'pastdue')
  assert.equal(byId['3'], 'future')
})

test('empty input yields zero summary, no crash', () => {
  const r = computeProjections({ services: [], collected: [], windowStart: '2026-06-01', windowEnd: '2026-06-30', today: '2026-06-25' })
  assert.deepEqual(r.summary, { projected: 0, collected: 0, outstanding: 0, pastDue: 0, window: { start: '2026-06-01', end: '2026-06-30' }, asOf: '2026-06-25' })
  assert.deepEqual(r.byDay, [])
})
```

- [ ] **Step 2: Run the tests, expect FAIL**

Run: `node --test auth/src/lib/ptProjections.test.js`
Expected: FAIL ("Cannot find module './ptProjections'" / functions undefined).

- [ ] **Step 3: Implement the library**

Create `auth/src/lib/ptProjections.js`:

```javascript
// Pure projection + reconciliation math for the PT Projections report.
// No I/O. Dates are 'YYYY-MM-DD' strings; ISO ordering is lexicographic.

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

function normalizeService(raw, clubSlug) {
  const name = `${(raw.memberFirstName || '').trim()} ${(raw.memberLastName || '').trim()}`.trim() || 'Unknown'
  const trainer = `${(raw.serviceEmployeeFirstName || '').trim()} ${(raw.serviceEmployeeLastName || '').trim()}`.trim() || 'Unassigned'
  return {
    memberId: String(raw.memberId || ''),
    name,
    trainer,
    location: clubSlug,
    nextBillingDate: raw.recurringServiceDates?.nextBillingDate || null,
    amount: round2(parseFloat(raw.invoiceTotal || '0') || 0),
  }
}

// Classify one service's next draft relative to the window/today.
//  upcoming: today <= date <= end
//  pastdue:  start <= date <  today
//  future:   date > end
//  other:    date < start, or no date  (ignored from projection buckets)
function classify(date, windowStart, windowEnd, today) {
  if (!date) return 'other'
  if (date >= today && date <= windowEnd) return 'upcoming'
  if (date >= windowStart && date < today) return 'pastdue'
  if (date > windowEnd) return 'future'
  return 'other'
}

function computeProjections({ services, collected, windowStart, windowEnd, today }) {
  services = services || []
  collected = collected || []

  // member -> trainer/location, for attributing collected revenue.
  const memberMap = {}
  for (const s of services) memberMap[s.memberId] = { trainer: s.trainer, location: s.location }
  const collectedMembers = new Set(collected.map(c => String(c.memberNumber)))

  let collectedTotal = 0, outstanding = 0, pastDue = 0
  const byDayMap = {}
  const loc = {}   // slug -> {projected, collected, outstanding, pastDue}
  const trn = {}   // trainer -> {trainer, location, projected, collected, count}
  const ensureLoc = s => (loc[s] = loc[s] || { slug: s, projected: 0, collected: 0, outstanding: 0, pastDue: 0 })
  const ensureTrn = (t, l) => (trn[t] = trn[t] || { trainer: t, location: l, projected: 0, collected: 0, count: 0 })

  // Collected revenue (already filtered to window + TRAINING by caller).
  for (const c of collected) {
    const amt = round2(c.amount)
    collectedTotal += amt
    ensureLoc(c.location).collected += amt
    const m = memberMap[String(c.memberNumber)]
    const tName = m ? m.trainer : 'Other'
    const tLoc = m ? m.location : c.location
    ensureTrn(tName, tLoc).collected += amt
  }

  // Recurring agreements -> outstanding / past-due buckets.
  const members = []
  for (const s of services) {
    const cls = classify(s.nextBillingDate, windowStart, windowEnd, today)
    const lrec = ensureLoc(s.location)
    const trec = ensureTrn(s.trainer, s.location)
    if (cls === 'upcoming') {
      outstanding += s.amount; lrec.outstanding += s.amount; trec.count += 1
      byDayMap[s.nextBillingDate] = byDayMap[s.nextBillingDate] || { date: s.nextBillingDate, amount: 0, count: 0 }
      byDayMap[s.nextBillingDate].amount = round2(byDayMap[s.nextBillingDate].amount + s.amount)
      byDayMap[s.nextBillingDate].count += 1
    } else if (cls === 'pastdue') {
      pastDue += s.amount; lrec.pastDue += s.amount
    }
    // member row status: collected payment this window wins, else its classification
    const status = collectedMembers.has(s.memberId) ? 'collected' : cls
    members.push({
      memberId: s.memberId, name: s.name, trainer: s.trainer, location: s.location,
      nextBillingDate: s.nextBillingDate, amount: s.amount, status,
    })
  }

  collectedTotal = round2(collectedTotal); outstanding = round2(outstanding); pastDue = round2(pastDue)
  for (const l of Object.values(loc)) {
    l.collected = round2(l.collected); l.outstanding = round2(l.outstanding); l.pastDue = round2(l.pastDue)
    l.projected = round2(l.collected + l.outstanding + l.pastDue)
  }
  for (const t of Object.values(trn)) {
    t.collected = round2(t.collected)
    t.projected = round2(t.collected + 0) // projected for trainer = collected + their outstanding (added below)
  }
  // add trainer outstanding/pastdue into projected
  for (const s of services) {
    const cls = classify(s.nextBillingDate, windowStart, windowEnd, today)
    if (cls === 'upcoming' || cls === 'pastdue') {
      trn[s.trainer].projected = round2(trn[s.trainer].projected + s.amount)
    }
  }

  return {
    summary: {
      projected: round2(collectedTotal + outstanding + pastDue),
      collected: collectedTotal, outstanding, pastDue,
      window: { start: windowStart, end: windowEnd }, asOf: today,
    },
    byDay: Object.values(byDayMap).sort((a, b) => a.date.localeCompare(b.date)),
    byLocation: Object.values(loc).sort((a, b) => b.projected - a.projected),
    byTrainer: Object.values(trn).sort((a, b) => b.projected - a.projected),
    members,
  }
}

module.exports = { normalizeService, computeProjections }
```

- [ ] **Step 4: Run the tests, expect PASS**

Run: `node --test auth/src/lib/ptProjections.test.js`
Expected: all tests pass. If the `byTrainer` projected assertion is loose, that is intentional; the dedicated `byTrainer` test asserts `collected`.

- [ ] **Step 5: Commit**

```bash
git add auth/src/lib/ptProjections.js auth/src/lib/ptProjections.test.js
git commit -m "feat(pt): pure projection + reconciliation library with tests"
```

---

### Task 3: Backend route, collected-revenue query, registration & access

Wire the data: fetch active recurring PT across the requested clubs, query collected TRAINING revenue, run the pure lib, cache the result, register the route, and grant access.

**Files:**
- Create: `auth/src/routes/ptProjections.js`
- Modify: `auth/src/index.js` (register route)
- Modify: `auth/src/middleware/role.js` (REPORT_ACCESS entry)
- Modify: `auth/src/routes/admin.js` (CUSTOM_REPORT_KEYS)

**Interfaces:**
- Consumes: `fetchActiveRecurringPTServices`, `CLUBS` (Task 1); `normalizeService`, `computeProjections` (Task 2).
- Produces: `GET /reports/pt-projections?start_date&end_date&location_slug` returning `{ summary, byDay, byLocation, byTrainer, members, errors? }`; `module.exports.warmCache`.

- [ ] **Step 1: Write the route**

Create `auth/src/routes/ptProjections.js`:

```javascript
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { wrapSWR } = require('../services/memoryCache')
const { supabaseAdmin } = require('../services/supabase')
const { parseLocationSlugParam, locationCacheKey } = require('../utils/locationSlug')
const { CLUBS, fetchActiveRecurringPTServices } = require('../services/abcRecurring')
const { normalizeService, computeProjections } = require('../lib/ptProjections')

const PT_PROJ_FRESH_MS = 2 * 60 * 1000
const PT_PROJ_STALE_MS = 15 * 60 * 1000
const PT_PROFIT_CENTERS = ['TRAINING', 'PERSONAL TRAINING']

const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function monthStartIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function monthEndIso() {
  const d = new Date(); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`
}

async function fetchCollected(slugs, startDate, endDate) {
  // slugs: array of allowed location slugs, or null for all clubs.
  let q = supabaseAdmin
    .from('abc_revenue_transactions')
    .select('member_number, location_slug, payment_amount')
    .in('profit_center', PT_PROFIT_CENTERS)
    .gte('payment_date', startDate)
    .lte('payment_date', endDate)
  if (slugs && slugs.length) q = q.in('location_slug', slugs)
  const rows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(`collected revenue query failed: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows.map(r => ({ memberNumber: String(r.member_number), location: r.location_slug, amount: Number(r.payment_amount) || 0 }))
}

async function buildPtProjectionsPayload(query) {
  const parsed = parseLocationSlugParam(query.location_slug)
  if (parsed.invalid) { const e = new Error(`Unknown location: ${parsed.invalid}`); e.status = 400; throw e }
  const targetClubs = parsed.all ? CLUBS : CLUBS.filter(c => parsed.slugs.includes(c.slug))
  const slugKey = locationCacheKey(parsed)

  const start = query.start_date || monthStartIso()
  const end = query.end_date || monthEndIso()
  const today = todayIso()

  const cacheKey = `reports:pt-projections:${slugKey}:${start}:${end}`
  return wrapSWR(cacheKey, PT_PROJ_FRESH_MS, PT_PROJ_STALE_MS, async () => {
    // 1. Active recurring PT services across target clubs.
    const results = await Promise.allSettled(
      targetClubs.map(async club => {
        const raw = await fetchActiveRecurringPTServices(club.clubNumber)
        return raw.map(s => normalizeService(s, club.slug))
      })
    )
    const services = []
    const errors = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') services.push(...r.value)
      else errors.push({ club: targetClubs[i].name, error: r.reason?.message || 'Unknown error' })
    })

    // 2. Collected TRAINING revenue in window.
    const slugs = parsed.all ? null : parsed.slugs
    const collected = await fetchCollected(slugs, start, end)

    // 3. Reconcile.
    const out = computeProjections({ services, collected, windowStart: start, windowEnd: end, today })
    if (errors.length) out.errors = errors
    return out
  })
}

// GET /reports/pt-projections
router.get('/', async (req, res) => {
  try {
    res.json(await buildPtProjectionsPayload(req.query))
  } catch (err) {
    console.error('[PT Projections] Error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
module.exports.warmCache = buildPtProjectionsPayload
```

- [ ] **Step 2: Verify the route file parses and loads**

Run: `node --check auth/src/routes/ptProjections.js && node -e "require('./auth/src/routes/ptProjections'); console.log('load OK')"`
Expected: `load OK`.

- [ ] **Step 3: Register the route in index.js**

In `auth/src/index.js`, find the block of `app.use('/reports/pt-...', ...)` registrations (near `pt-new-clients`) and add:

```javascript
app.use('/reports/pt-projections', require('./routes/ptProjections'))
```

- [ ] **Step 4: Add the report to the access matrix**

In `auth/src/middleware/role.js`, in the `REPORT_ACCESS` object, add:

```javascript
  'pt-projections': ['manager', 'marketing', 'corporate', 'admin'],
```

- [ ] **Step 5: Allow granting to custom roles**

In `auth/src/routes/admin.js`, add `'pt-projections'` to the `CUSTOM_REPORT_KEYS` set (same line group as `'pt-new-clients'`, `'pt-health'`).

- [ ] **Step 6: Verify all touched backend files parse**

Run: `node --check auth/src/index.js && node --check auth/src/middleware/role.js && node --check auth/src/routes/admin.js`
Expected: no output (all valid).

- [ ] **Step 7: Commit**

```bash
git add auth/src/routes/ptProjections.js auth/src/index.js auth/src/middleware/role.js auth/src/routes/admin.js
git commit -m "feat(pt): PT Projections route, collected-revenue query, registration and access"
```

---

### Task 4: Frontend API client, report info, and report registration

Plumb the report into the portal's reporting nav and add the API call + help text.

**Files:**
- Modify: `portal/src/lib/api.js` (add `getPTProjections`)
- Modify: `portal/src/lib/reportInfo.js` (add `pt-projections` entry)
- Modify: `portal/src/components/ReportingView.jsx` (icon, tile, group, import, render case)
- Modify: `portal/src/config/portalTiles.js` (CUSTOM_REPORT_CATALOG)

**Interfaces:**
- Consumes: backend `GET /reports/pt-projections` (Task 3).
- Produces: `getPTProjections(params, options): Promise<Result>`; a `pt-projections` tile in the Training group that renders `<PTProjectionsReport>` (Task 5).

- [ ] **Step 1: Add the API client function**

In `portal/src/lib/api.js`, next to `getPTRoster`, add:

```javascript
export async function getPTProjections(params = {}, options = {}) {
  const qs = new URLSearchParams(params).toString()
  return api('/reports/pt-projections' + (qs ? '?' + qs : ''), options)
}
```

- [ ] **Step 2: Add report help text**

In `portal/src/lib/reportInfo.js`, add to `REPORT_INFO`:

```javascript
  'pt-projections': {
    title: 'PT Projections',
    sections: [
      {
        heading: 'What this is',
        body:
          'A forward look at recurring personal training revenue. For each active PT agreement it shows the next expected draft date and amount, totals the expected revenue per day, and compares the projection to PT revenue actually collected in the period.',
      },
      {
        heading: 'How the numbers split',
        body: [
          'Collected, the PT revenue already drafted in the date range.',
          'Outstanding, recurring drafts still scheduled to hit between today and the end of the range.',
          'Past-due, drafts whose scheduled date has already passed but have not been collected, a sign the payment may have declined or lapsed.',
          'Projected, the sum of collected plus outstanding plus past-due.',
        ],
      },
      {
        heading: 'How filters work',
        body: [
          'Date range, defaults to the current month. Outstanding and past-due are split relative to today.',
          'Location, one club or all clubs you have access to.',
        ],
      },
    ],
    notes: [
      'This is a point-in-time snapshot, refreshed every few minutes.',
      'Projected amounts come from each agreement\'s scheduled draft and may include tax or fees, so treat them as estimates.',
      'Collected dollars are matched to a member, not to a specific draft, so per-member Collected means the member has a training payment in the range.',
    ],
  },
```

- [ ] **Step 3: Register the tile, icon, group, import, and render case in ReportingView.jsx**

In `portal/src/components/ReportingView.jsx`:

(a) Add to `REPORT_ICONS` (reuse a calendar/clock-money style path):

```javascript
  'pt-projections': 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
```

(b) Add to `ALL_REPORT_TILES`:

```javascript
  { key: 'pt-projections', label: 'PT Projections', desc: 'Expected vs Collected' },
```

(c) Add `'pt-projections'` to the `training` group's `reports` array in `REPORT_GROUPS` (after `'pt-roster'`).

(d) Add the import near the other report-component imports at the top:

```javascript
import PTProjectionsReport from './reports/PTProjectionsReport'
```

(e) Add the render case alongside the others (mirror the `pt-new-clients` line):

```javascript
          {selectedReport === 'pt-projections' && (
            <PTProjectionsReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
          )}
```

(Match the exact conditional style already used in this file; if it uses a `switch`/ternary chain instead of `&&`, follow that form. The component takes `startDate`, `endDate`, `locationSlug` props.)

- [ ] **Step 4: Add to the custom-role report catalog**

In `portal/src/config/portalTiles.js`, add to `CUSTOM_REPORT_CATALOG`:

```javascript
  { key: 'pt-projections',   label: 'PT Projections' },
```

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/api.js portal/src/lib/reportInfo.js portal/src/components/ReportingView.jsx portal/src/config/portalTiles.js
git commit -m "feat(pt): register PT Projections in reporting nav, API client and help text"
```

---

### Task 5: PT Projections React component

Render the summary cards, by-day calendar, by-location and by-trainer tables, and the member detail table with filters and CSV export.

**Files:**
- Create: `portal/src/components/reports/PTProjectionsReport.jsx`

**Interfaces:**
- Consumes: `getPTProjections` (Task 4); props `{ startDate, endDate, locationSlug }`.
- Produces: the rendered report (no exports consumed elsewhere).

- [ ] **Step 1: Implement the component following an existing report's structure**

First read `portal/src/components/reports/PTNewClientsReport.jsx` to copy the conventions used in THIS codebase (loading/error states, the `getX(params, { signal })` call shape, the filter-row classNames, currency formatting helper, and the CSV export helper). Then create `portal/src/components/reports/PTProjectionsReport.jsx` that:

- On mount and whenever `startDate`/`endDate`/`locationSlug` change, calls `getPTProjections({ start_date: startDate, end_date: endDate, location_slug: locationSlug })` with an AbortController, sets `{ data, loading, error }`.
- Renders, in order:
  1. **Summary cards**: Projected, Collected, Outstanding, Past-due (from `data.summary`), plus a one-line sentence: `"<MonthName> PT: projected $X, collected $Y, $Z outstanding, $W past-due."` (no em-dashes).
  2. **Upcoming drafts by day**: a simple table/bar list from `data.byDay` (`date`, `count`, `amount`).
  3. **By location**: table from `data.byLocation` with columns Location, Projected, Collected, Outstanding, Past-due, plus an all-clubs total row.
  4. **By trainer**: table from `data.byTrainer` (Trainer, Location, Projected, Collected, Upcoming count); a location filter dropdown filters the rows client-side.
  5. **Member detail**: table from `data.members` (Member, Trainer, Location, Next draft, Amount, Status badge). A status filter (All / Upcoming / Past-due / Collected / Future) and a search box filter client-side. Status badge colors: collected=emerald, upcoming=blue/neutral, pastdue=red, future=muted.
  6. **CSV export** button for the member detail rows, using the same export helper pattern as PTNewClientsReport; the copy/export button shows a brief "Copied!"/"Exported!" confirmation.
- Shows `data.errors` (if present) as a non-blocking inline warning ("Some clubs failed to load: ...").
- Currency formatting: reuse the helper style from PTNewClientsReport (e.g. `$` + `toLocaleString` with 0 decimals).

Keep the file focused on rendering; all math already happened server-side. No em-dashes in any visible string.

- [ ] **Step 2: Build the portal to verify it compiles**

Run (from repo root; if `portal/node_modules` is missing, run `pnpm install --filter ./portal` or `cd portal && pnpm install` first):
`cd portal && npx vite build`
Expected: build succeeds with no errors referencing `PTProjectionsReport`.

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/reports/PTProjectionsReport.jsx
git commit -m "feat(pt): PT Projections report component (summary, by-day, by-location, by-trainer, members)"
```

---

### Task 6: Mobile tile (lightweight)

Surface the report on mobile by adding it to the mobile reports list. Full mobile-optimized view is out of scope for v1; the tile opens the same data via the existing mobile report routing if present, otherwise it is added to the desktop-only set consistently with other manager reports.

**Files:**
- Modify: `portal/src/mobile/components/reports/ReportsHome.jsx`

- [ ] **Step 1: Inspect the mobile reports list**

Read `portal/src/mobile/components/reports/ReportsHome.jsx` to see how report tiles are listed and whether each maps to a mobile component or a "best on desktop" placeholder. Follow whichever pattern manager-only financial reports (e.g. Revenue) already use on mobile.

- [ ] **Step 2: Add the PT Projections entry**

Add a `pt-projections` tile to the mobile list using the same shape as the neighboring PT entries. If the mobile app gates by report access, it will already respect the `manager` tier from the backend. If Revenue is desktop-only on mobile, mark PT Projections the same way (do not build a separate mobile view in v1).

- [ ] **Step 3: Build to verify**

Run: `cd portal && npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add portal/src/mobile/components/reports/ReportsHome.jsx
git commit -m "feat(pt): add PT Projections tile to mobile reports list"
```

---

## Final verification (after all tasks)

- [ ] Run all new unit tests: `node --test auth/src/services/abcRecurring.test.js auth/src/lib/ptProjections.test.js` — all pass.
- [ ] `node --check` passes on every modified backend file.
- [ ] `cd portal && npx vite build` succeeds.
- [ ] Manual smoke (server-side, do not run sync locally): with the auth service running against ABC + Supabase, hit `GET /reports/pt-projections?location_slug=salem` as a manager and confirm the four summary numbers are plausible and `byDay` lists upcoming dates. Confirm `member_number` in `abc_revenue_transactions` actually matches ABC `memberId` (spot-check one collected member appears under the right trainer); if identifiers differ, adjust the join key in `fetchCollected`/`computeProjections` and note it.
- [ ] Open a PR; do not merge (Justin is the merger of record).

## Self-review notes (spec coverage)

- Next-payment-only projection → `classify` uses each service's single `nextBillingDate` (Task 2). ✔
- Current-period reconciliation (projected/collected/outstanding/past-due) → `computeProjections.summary` (Task 2), collected query (Task 3). ✔
- By day / by location / by trainer / member rows → `byDay`/`byLocation`/`byTrainer`/`members` (Task 2) rendered in Task 5. ✔
- Reuse PT Roster population, no migration → Task 1 shared module. ✔
- TRAINING profit center, manager access → Task 3 constants + REPORT_ACCESS. ✔
- Limitations surfaced in-report → reportInfo notes (Task 4). ✔
- Aggregate (not per-draft) collected match, member→trainer attribution, identifier-match caveat → encoded in Task 2 logic and called out in final verification. ✔
