# Group X Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin Group X class scheduler that writes real classes into ABC, records post-class headcounts in Supabase, reports on class performance, and publishes a Monday-Sunday class board for the WCS website and in-gym TVs.

**Architecture:** ABC is the source of truth for what is scheduled — there is no local mirror of the class schedule, so nothing needs reconciling when someone edits a class inside ABC. Supabase owns only how a class went (headcount) plus the recurring-series definition. Two Express routers on the existing auth API — one admin-gated (`/group-x`), one public and cached (`/public/group-x`) — back a new admin React view and a self-contained HTML board.

**Tech Stack:** Node 20 / Express (auth API), `node:test` + `node:assert`, axios, Supabase JS (service role), React 19 + Vite 8 + Tailwind 4 (portal).

**Spec:** `docs/superpowers/specs/2026-07-30-group-x-scheduler-design.md`

## Global Constraints

- **Worktree:** all work happens in `C:\Users\justi\wcs-worktrees\groupx` on branch `feat/group-x-scheduler`. Another session may be active in the main repo.
- **One PR per concern.** Tasks map to PRs A–F. Each PR is opened off `master` and is independently mergeable. Never append separable follow-on work to an open PR.
- **Do not merge.** Open PRs only. Justin is the merger of record.
- **Tests:** `node:test` + `node:assert`, files named `*.test.js` beside the source. Run with `node --test <path>` from `auth/`. There is no `test` npm script; Task 1 adds one.
- **Migrations are manual.** This repo has no migration runner. `auth/migrations/*.sql` must be applied to prod Supabase by hand after merge.
- **RLS:** every new public table gets `enable row level security` with **no policy**. The portal DB is 100% service-role.
- **Whole-row upserts.** A partial `.upsert()` fails NOT NULL columns even when the row already exists.
- **Dark backdrop.** Every portal content block wraps in a `bg-surface` card or it renders invisible.
- **No em-dashes** in any user-facing copy (portal UI or public board).
- **Omit empty rows.** Reports and displays never render a row stating a class/instructor had no data.
- **Admin gate:** every `/group-x` endpoint is `authenticate` + `requireRole('admin')`.
- **ABC casing:** `/calendars/eventtypes` returns `category: "class"` (lowercase); `/calendars/events` returns `category: "Class"` (capitalized). Normalize with `.toLowerCase()` at every comparison.
- **ABC timestamps** are naive club-local Pacific (`"2026-07-28 10:00:00.000000"`), never UTC.
- **Club allowlist** (slug → clubNumber): salem 30935, keizer 31599, eugene 7655, springfield 31598, clackamas 31600, milwaukie 31601, medford 32073.

---

## File Structure

**PR A — foundation + reads**
- Create `auth/src/lib/abcTime.js` — Pacific timestamp parsing and date-window math. Sole owner of ABC's timezone quirk.
- Create `auth/src/lib/abcTime.test.js`
- Create `auth/src/lib/groupXClubs.js` — the club slug/number allowlist, shared by both routers.
- Create `auth/src/services/abcGroupX.js` — ABC HTTP calls (event types, employees, events, create, cancel). No Express, no Supabase, so it is directly testable.
- Create `auth/src/routes/groupX.js` — admin router, read endpoints only in this PR.
- Create `auth/migrations/093_group_x.sql`
- Modify `auth/src/index.js` — mount `/group-x`.
- Modify `auth/src/routes/abcScheduler.js:593-605` — delete local `isDstPacific`/`parseAbcTs`, import from `abcTime.js`.
- Modify `auth/package.json` — add `test` script.

**PR B — staff calendar UI**
- Create `portal/src/lib/weekGrid.js` + `weekGrid.test.js` — grid/date helpers extracted from `PtSchedulerView.jsx`.
- Create `portal/src/components/groupx/GroupXView.jsx` — shell: club selector, week nav, data loading.
- Create `portal/src/components/groupx/WeekGrid.jsx` — the 7-column grid and class blocks.
- Create `portal/src/components/groupx/CreateClassModal.jsx`
- Modify `auth/src/routes/groupX.js` — add `POST /classes`, `DELETE /classes/:eventId`.
- Modify `portal/src/components/AdminPanel.jsx` — register the `group-x` experimental tile.
- Modify `portal/src/components/admin/PtSchedulerView.jsx:23-95` — import the extracted helpers, delete local copies.

**PR C — recurring series**
- Create `auth/src/lib/groupXSeries.js` + `groupXSeries.test.js` — pure occurrence expansion. No I/O.
- Create `portal/src/components/groupx/CreateSeriesModal.jsx`
- Modify `auth/src/routes/groupX.js` — add `POST /series`, `DELETE /series/:id`.

**PR D — attendance**
- Create `portal/src/components/groupx/AttendanceModal.jsx`
- Modify `auth/src/routes/groupX.js` — add `PUT /classes/:eventId/attendance`; join attendance into `GET /classes`.
- Modify `portal/src/components/groupx/GroupXView.jsx` — needs-attendance strip.

**PR E — public board**
- Create `auth/src/lib/groupXPublic.js` + `groupXPublic.test.js` — payload shaping and Monday-week math.
- Create `auth/src/routes/publicGroupX.js` — `/schedule` JSON + `/board` HTML.
- Create `auth/src/templates/groupXBoard.js` — the self-contained HTML/CSS document.
- Modify `auth/src/index.js` — mount public CORS **before** global CORS, mount `/public/group-x`.

**PR F — report**
- Create `auth/src/lib/groupXReport.js` + `groupXReport.test.js` — pure aggregation.
- Create `portal/src/components/groupx/GroupXReport.jsx`
- Modify `auth/src/routes/groupX.js` — add `GET /report`.

---

# PR A — Foundation and read endpoints

### Task 1: ABC time helpers

**Files:**
- Create: `auth/src/lib/abcTime.js`
- Test: `auth/src/lib/abcTime.test.js`
- Modify: `auth/package.json`
- Modify: `auth/src/routes/abcScheduler.js` (lines 593-605, delete local copies)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isDstPacific(date: Date) -> boolean`
  - `parseAbcTs(s: string|null) -> { utc: string|null, local: string|null }`
  - `padDate(isoDate: string, days: number) -> string` — 'YYYY-MM-DD' shifted by N days
  - `toIsoDate(d: Date) -> string` — UTC-based 'YYYY-MM-DD'

- [ ] **Step 1: Add the test script**

In `auth/package.json`, add to `scripts`:

```json
"test": "node --test src/"
```

- [ ] **Step 2: Write the failing test**

Create `auth/src/lib/abcTime.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { isDstPacific, parseAbcTs, padDate, toIsoDate } = require('./abcTime')

test('parseAbcTs converts a PDT summer timestamp to UTC', () => {
  // 2026-07-28 10:00 Pacific (PDT, -07:00) === 17:00 UTC
  const r = parseAbcTs('2026-07-28 10:00:00.000000')
  assert.strictEqual(r.utc, '2026-07-28T17:00:00.000Z')
  assert.strictEqual(r.local, '2026-07-28 10:00:00')
})

test('parseAbcTs converts a PST winter timestamp to UTC', () => {
  // 2026-01-15 10:00 Pacific (PST, -08:00) === 18:00 UTC
  const r = parseAbcTs('2026-01-15 10:00:00.000000')
  assert.strictEqual(r.utc, '2026-01-15T18:00:00.000Z')
})

test('parseAbcTs accepts the ISO T separator ABC sometimes returns', () => {
  const r = parseAbcTs('2026-07-28T10:00:00.000000')
  assert.strictEqual(r.utc, '2026-07-28T17:00:00.000Z')
})

test('parseAbcTs returns nulls for empty input', () => {
  assert.deepStrictEqual(parseAbcTs(null), { utc: null, local: null })
  assert.deepStrictEqual(parseAbcTs(''), { utc: null, local: null })
})

test('isDstPacific brackets the 2026 DST transitions', () => {
  // DST 2026: starts Mar 8, ends Nov 1.
  assert.strictEqual(isDstPacific(new Date('2026-03-07T12:00:00Z')), false)
  assert.strictEqual(isDstPacific(new Date('2026-03-09T12:00:00Z')), true)
  assert.strictEqual(isDstPacific(new Date('2026-10-31T12:00:00Z')), true)
  assert.strictEqual(isDstPacific(new Date('2026-11-02T12:00:00Z')), false)
})

test('padDate shifts a date string and crosses month boundaries', () => {
  assert.strictEqual(padDate('2026-07-28', 1), '2026-07-29')
  assert.strictEqual(padDate('2026-08-01', -1), '2026-07-31')
  assert.strictEqual(padDate('2026-01-01', -1), '2025-12-31')
})

test('toIsoDate formats a Date as UTC YYYY-MM-DD', () => {
  assert.strictEqual(toIsoDate(new Date('2026-07-28T23:30:00Z')), '2026-07-28')
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd auth && node --test src/lib/abcTime.test.js`
Expected: FAIL — `Cannot find module './abcTime'`

- [ ] **Step 4: Write the implementation**

Create `auth/src/lib/abcTime.js`. The DST math is lifted verbatim from `abcScheduler.js:593-605`, which is the behavior currently in production.

```js
// ABC returns naive club-local Pacific timestamps ("2026-07-28 10:00:00.000000"),
// never UTC and never with an offset. This module is the single place that
// knows that. Everything else in the codebase should import from here rather
// than re-deriving the offset.

// US Pacific DST: second Sunday in March through first Sunday in November.
function isDstPacific(d) {
  const y = d.getUTCFullYear()
  const mar = new Date(Date.UTC(y, 2, 1))
  mar.setUTCDate(mar.getUTCDate() + ((7 - mar.getUTCDay()) % 7) + 7)
  const nov = new Date(Date.UTC(y, 10, 1))
  nov.setUTCDate(nov.getUTCDate() + ((7 - nov.getUTCDay()) % 7))
  return d >= mar && d < nov
}

// "2026-07-28 10:00:00.000000" -> { utc: ISO string, local: "2026-07-28 10:00:00" }
function parseAbcTs(s) {
  if (!s) return { utc: null, local: null }
  const cleaned = String(s).replace('T', ' ').replace(/\.\d+$/, '')
  // Probe the offset by reading the naive time as if it were UTC. Only ever
  // wrong inside the one ambiguous hour of the fall-back transition, when a
  // class is not being taught anyway.
  const probe = new Date(cleaned + 'Z')
  const offset = isDstPacific(probe) ? '-07:00' : '-08:00'
  return { utc: new Date(cleaned.replace(' ', 'T') + offset).toISOString(), local: cleaned }
}

// 'YYYY-MM-DD' shifted by N days, still 'YYYY-MM-DD'.
function padDate(s, days) {
  const d = new Date(s + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return toIsoDate(d)
}

function toIsoDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

module.exports = { isDstPacific, parseAbcTs, padDate, toIsoDate }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd auth && node --test src/lib/abcTime.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 6: Remove the duplicated copies from abcScheduler.js**

In `auth/src/routes/abcScheduler.js`, delete the `isDstPacific` and `parseAbcTs` function definitions (lines 593-605) and add near the top imports:

```js
const { isDstPacific, parseAbcTs, padDate } = require('../lib/abcTime')
```

Also delete the local `padDate` defined inline in the `/events` handler (lines 56-59) and the `fmtDate` helper in `/events/:eventId/refresh-from-abc` (line 647), replacing `fmtDate(d)` calls with `toIsoDate(d)` and adding `toIsoDate` to the import. Leave every other line of that file alone — PT Scheduler behavior must not change.

- [ ] **Step 7: Verify abcScheduler still loads**

Run: `cd auth && node -e "require('./src/routes/abcScheduler'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 8: Commit**

```bash
git add auth/src/lib/abcTime.js auth/src/lib/abcTime.test.js auth/src/routes/abcScheduler.js auth/package.json
git commit -m "refactor(auth): extract ABC Pacific time helpers into lib/abcTime"
```

---

### Task 2: Club allowlist

**Files:**
- Create: `auth/src/lib/groupXClubs.js`
- Test: `auth/src/lib/groupXClubs.test.js`

**Interfaces:**
- Produces:
  - `CLUBS: Array<{ slug: string, name: string, clubNumber: string }>`
  - `clubBySlug(slug: string) -> {slug,name,clubNumber} | null`
  - `isKnownClubNumber(n: string) -> boolean`

- [ ] **Step 1: Write the failing test**

Create `auth/src/lib/groupXClubs.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { CLUBS, clubBySlug, isKnownClubNumber } = require('./groupXClubs')

test('CLUBS has all seven gyms', () => {
  assert.strictEqual(CLUBS.length, 7)
})

test('clubBySlug resolves a known slug case-insensitively', () => {
  assert.strictEqual(clubBySlug('salem').clubNumber, '30935')
  assert.strictEqual(clubBySlug('SALEM').clubNumber, '30935')
})

test('clubBySlug returns null for an unknown slug', () => {
  assert.strictEqual(clubBySlug('portland'), null)
  assert.strictEqual(clubBySlug(''), null)
  assert.strictEqual(clubBySlug(undefined), null)
})

test('isKnownClubNumber rejects a club we do not own', () => {
  assert.strictEqual(isKnownClubNumber('30935'), true)
  assert.strictEqual(isKnownClubNumber('99999'), false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd auth && node --test src/lib/groupXClubs.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `auth/src/lib/groupXClubs.js`:

```js
// The seven WCS clubs. Mirrors CLUB_NUMBERS in portal/src/components/admin/
// PtSchedulerView.jsx. This is an allowlist, not a convenience map: the public
// board is unauthenticated, so an unrecognized slug must 404 rather than let a
// caller proxy an arbitrary club number through our ABC credentials.
const CLUBS = [
  { slug: 'salem', name: 'Salem', clubNumber: '30935' },
  { slug: 'keizer', name: 'Keizer', clubNumber: '31599' },
  { slug: 'eugene', name: 'Eugene', clubNumber: '7655' },
  { slug: 'springfield', name: 'Springfield', clubNumber: '31598' },
  { slug: 'clackamas', name: 'Clackamas', clubNumber: '31600' },
  { slug: 'milwaukie', name: 'Milwaukie', clubNumber: '31601' },
  { slug: 'medford', name: 'Medford', clubNumber: '32073' },
]

function clubBySlug(slug) {
  if (!slug) return null
  const s = String(slug).toLowerCase()
  return CLUBS.find(c => c.slug === s) || null
}

function isKnownClubNumber(n) {
  return CLUBS.some(c => c.clubNumber === String(n))
}

module.exports = { CLUBS, clubBySlug, isKnownClubNumber }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd auth && node --test src/lib/groupXClubs.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add auth/src/lib/groupXClubs.js auth/src/lib/groupXClubs.test.js
git commit -m "feat(auth): add Group X club allowlist"
```

---

### Task 3: ABC Group X service

**Files:**
- Create: `auth/src/services/abcGroupX.js`
- Test: `auth/src/services/abcGroupX.test.js`

**Interfaces:**
- Consumes: `abcTime.parseAbcTs`, `abcTime.padDate`, `groupXClubs.isKnownClubNumber`, `services/memoryCache.wrap`.
- Produces:
  - `listClassTypes(clubNumber) -> Promise<ClassType[]>` where
    `ClassType = { event_type_id, name, description, duration_minutes, max_attendees, training_levels: [{level_id, level_name}] }`
  - `listInstructors(clubNumber) -> Promise<Instructor[]>` where
    `Instructor = { employee_id, first_name, last_name, display_name, department }`
  - `listClasses(clubNumber, startDate, endDate) -> Promise<ClassEvent[]>` where
    `ClassEvent = { event_id, event_type_id, class_name, event_timestamp, event_timestamp_local, status, duration_minutes, max_attendees, employee_id, instructor_name }`
  - `createClass(clubNumber, { event_type_id, employee_id, event_timestamp_local, duration_minutes, training_level_id }) -> Promise<{ ok, event_id, http, error }>`
  - `cancelClass(clubNumber, eventId) -> Promise<{ ok, http, error }>`
  - `_shapeClassType(raw)`, `_shapeInstructor(raw)`, `_shapeClassEvent(raw)` — exported for tests.
  - `GX_DEPARTMENTS = ['Group Exercise', 'Personal Trainers']`

The three `_shape*` functions are pure and are what the tests exercise. The network functions are thin wrappers around axios and are verified manually in Task 6.

- [ ] **Step 1: Write the failing test**

Create `auth/src/services/abcGroupX.test.js`. Fixtures are trimmed from real ABC responses captured 2026-07-30.

```js
const test = require('node:test')
const assert = require('node:assert')
const { _shapeClassType, _shapeInstructor, _shapeClassEvent, GX_DEPARTMENTS } = require('./abcGroupX')

const RAW_TYPE = {
  eventTypeId: '481132d6f4f1477b89474c8052b5b972',
  name: 'Barbell Strength',
  category: 'class',
  description: 'Strengthen your foundation with expert guidance.',
  duration: '60',
  maxAttendees: '10',
  eventTrainingLevels: [{ levelId: 'xzxxxxxxxxxxxxxxxxxxxxxxxxxxx001', levelName: '1' }],
}

const RAW_EVENT = {
  eventId: '6b63633197d240eab24027463b4b829b',
  eventTypeId: 'f3430edede864e53aed5313e10d4bd14',
  eventName: 'Bootcamp',
  category: 'Class',
  eventTimestamp: '2026-07-28 10:00:00.000000',
  status: 'Completed',
  duration: '60',
  maxAttendees: '12',
  employeeId: '3b193d59a95c42c4b8ba5ac2351f192a',
  employeeFirstName: 'Matthew',
  employeeLastName: 'Astley',
}

const RAW_EMPLOYEE = {
  employeeId: 'abc123',
  personal: { firstName: 'Jane', lastName: 'Doe' },
  employment: { employeeStatus: 'active', departments: { department: ['Group Exercise'] } },
}

test('_shapeClassType coerces ABC string numbers to numbers', () => {
  const t = _shapeClassType(RAW_TYPE)
  assert.strictEqual(t.event_type_id, '481132d6f4f1477b89474c8052b5b972')
  assert.strictEqual(t.name, 'Barbell Strength')
  assert.strictEqual(t.duration_minutes, 60)
  assert.strictEqual(t.max_attendees, 10)
  assert.deepStrictEqual(t.training_levels, [
    { level_id: 'xzxxxxxxxxxxxxxxxxxxxxxxxxxxx001', level_name: '1' },
  ])
})

test('_shapeClassType tolerates a type with no training levels or capacity', () => {
  const t = _shapeClassType({ eventTypeId: 'x', name: 'Yoga', duration: '60' })
  assert.strictEqual(t.max_attendees, null)
  assert.deepStrictEqual(t.training_levels, [])
})

test('_shapeClassEvent maps the event and resolves the Pacific timestamp', () => {
  const e = _shapeClassEvent(RAW_EVENT)
  assert.strictEqual(e.event_id, '6b63633197d240eab24027463b4b829b')
  assert.strictEqual(e.class_name, 'Bootcamp')
  assert.strictEqual(e.event_timestamp, '2026-07-28T17:00:00.000Z')
  assert.strictEqual(e.event_timestamp_local, '2026-07-28 10:00:00')
  assert.strictEqual(e.instructor_name, 'Matthew Astley')
  assert.strictEqual(e.max_attendees, 12)
})

test('_shapeClassEvent collapses ABC double spaces in instructor names', () => {
  // ABC returns employeeName as "Matthew  Astley" with two spaces; we build the
  // name from the first/last fields instead, so it must come out single-spaced.
  const e = _shapeClassEvent({ ...RAW_EVENT, employeeName: 'Matthew  Astley' })
  assert.strictEqual(e.instructor_name, 'Matthew Astley')
})

test('_shapeInstructor extracts the department array', () => {
  const i = _shapeInstructor(RAW_EMPLOYEE)
  assert.strictEqual(i.display_name, 'Jane Doe')
  assert.strictEqual(i.department, 'Group Exercise')
})

test('_shapeInstructor returns null department when ABC has none', () => {
  const i = _shapeInstructor({
    employeeId: 'y',
    personal: { firstName: 'No', lastName: 'Dept' },
    employment: { employeeStatus: 'active', departments: { department: [] } },
  })
  assert.strictEqual(i.department, null)
})

test('GX_DEPARTMENTS is Group Exercise first, then Personal Trainers', () => {
  assert.deepStrictEqual(GX_DEPARTMENTS, ['Group Exercise', 'Personal Trainers'])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd auth && node --test src/services/abcGroupX.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `auth/src/services/abcGroupX.js`:

```js
// All ABC HTTP for Group X lives here. No Express, no Supabase — the shaping
// functions are pure and unit-tested, the network functions are thin.
//
// Verified live against the production ABC API 2026-07-30:
//   GET  /{club}/calendars/eventtypes   -> 21 types/club, 6 with category "class"
//   GET  /{club}/employees              -> employment.departments.department[]
//   GET  /{club}/calendars/events       -> both future ("Pending") and past
//                                          ("Completed") when no eventStatus filter
//   POST /{club}/calendars/events       -> create (no member required for a class)
//   DELETE /{club}/calendars/events/{id}
const axios = require('axios')
const { parseAbcTs, padDate } = require('../lib/abcTime')
const { isKnownClubNumber } = require('../lib/groupXClubs')
const cache = require('./memoryCache')

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const ABC_APP_ID = process.env.ABC_APP_ID
const ABC_APP_KEY = process.env.ABC_APP_KEY

// Instructors come from these ABC departments, in this order. Only 1-2 staff
// per club are tagged "Group Exercise" today, so Personal Trainers keeps the
// dropdown usable until that is fixed on the ABC side.
const GX_DEPARTMENTS = ['Group Exercise', 'Personal Trainers']

const TYPES_TTL_MS = 60 * 60 * 1000
const EMPLOYEES_TTL_MS = 60 * 60 * 1000

function abcHeaders() {
  if (!ABC_APP_ID || !ABC_APP_KEY) throw new Error('ABC_APP_ID and ABC_APP_KEY must be set')
  return { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' }
}

function assertClub(clubNumber) {
  if (!isKnownClubNumber(clubNumber)) throw new Error(`Unknown club number: ${clubNumber}`)
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? null : n
}

// ABC pads names with stray double spaces. Always rebuild from first/last.
function joinName(first, last) {
  return [first, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function _shapeClassType(raw) {
  return {
    event_type_id: raw.eventTypeId,
    name: raw.name,
    description: raw.description || null,
    duration_minutes: num(raw.duration),
    max_attendees: num(raw.maxAttendees),
    training_levels: (raw.eventTrainingLevels || []).map(l => ({
      level_id: l.levelId,
      level_name: l.levelName,
    })),
  }
}

function _shapeInstructor(raw) {
  const depts = raw.employment?.departments?.department || []
  return {
    employee_id: raw.employeeId,
    first_name: raw.personal?.firstName || '',
    last_name: raw.personal?.lastName || '',
    display_name: joinName(raw.personal?.firstName, raw.personal?.lastName) || 'Unknown',
    department: depts.find(d => GX_DEPARTMENTS.includes(d)) || depts[0] || null,
  }
}

function _shapeClassEvent(raw) {
  const ts = parseAbcTs(raw.eventTimestamp)
  return {
    event_id: raw.eventId,
    event_type_id: raw.eventTypeId || null,
    class_name: raw.eventName || null,
    event_timestamp: ts.utc,
    event_timestamp_local: ts.local,
    status: raw.status || null,
    duration_minutes: num(raw.duration),
    max_attendees: num(raw.maxAttendees),
    employee_id: raw.employeeId || null,
    instructor_name: joinName(raw.employeeFirstName, raw.employeeLastName) || null,
  }
}

async function listClassTypes(clubNumber) {
  assertClub(clubNumber)
  return cache.wrap(`gx:types:${clubNumber}`, TYPES_TTL_MS, async () => {
    const r = await axios.get(`${ABC_BASE_URL}/${clubNumber}/calendars/eventtypes`, {
      headers: abcHeaders(), timeout: 20000,
    })
    return (r.data?.eventTypes || [])
      // /calendars/eventtypes says "class"; /calendars/events says "Class".
      .filter(t => String(t.category || '').toLowerCase() === 'class')
      .map(_shapeClassType)
      .sort((a, b) => a.name.localeCompare(b.name))
  })
}

async function listInstructors(clubNumber) {
  assertClub(clubNumber)
  return cache.wrap(`gx:instructors:${clubNumber}`, EMPLOYEES_TTL_MS, async () => {
    const r = await axios.get(`${ABC_BASE_URL}/${clubNumber}/employees`, {
      headers: abcHeaders(), timeout: 20000,
    })
    return (r.data?.employees || [])
      .filter(e => String(e.employment?.employeeStatus || '').toLowerCase() === 'active')
      .map(_shapeInstructor)
      .filter(e => e.employee_id && GX_DEPARTMENTS.includes(e.department))
      .sort((a, b) => {
        const d = GX_DEPARTMENTS.indexOf(a.department) - GX_DEPARTMENTS.indexOf(b.department)
        return d !== 0 ? d : a.display_name.localeCompare(b.display_name)
      })
  })
}

// startDate/endDate are 'YYYY-MM-DD' inclusive, interpreted club-local.
async function listClasses(clubNumber, startDate, endDate) {
  assertClub(clubNumber)
  // Widen by a day each side: ABC reads eventDateRange as club-local Pacific
  // while we reason in UTC. Trimmed back by the caller.
  const r = await axios.get(`${ABC_BASE_URL}/${clubNumber}/calendars/events`, {
    headers: abcHeaders(),
    // No eventStatus filter: that is what makes future "Pending" classes visible.
    params: { eventDateRange: `${padDate(startDate, -1)},${padDate(endDate, 1)}`, size: 500 },
    timeout: 30000,
  })
  return (r.data?.events || [])
    .filter(e => String(e.category || '').toLowerCase() === 'class')
    .map(_shapeClassEvent)
    .filter(e => {
      const day = (e.event_timestamp_local || '').slice(0, 10)
      return day >= startDate && day <= endDate
    })
    .sort((a, b) => String(a.event_timestamp).localeCompare(String(b.event_timestamp)))
}

async function createClass(clubNumber, opts) {
  assertClub(clubNumber)
  const payload = {
    eventTypeId: opts.event_type_id,
    employeeId: opts.employee_id,
    eventTimestamp: opts.event_timestamp_local, // "YYYY-MM-DD HH:mm:ss", club-local
    duration: String(opts.duration_minutes),
  }
  if (opts.training_level_id) payload.eventTrainingLevelId = opts.training_level_id

  const r = await axios.post(`${ABC_BASE_URL}/${clubNumber}/calendars/events`, payload, {
    headers: { ...abcHeaders(), 'Content-Type': 'application/json' },
    timeout: 30000,
    validateStatus: () => true,
  })
  if (r.status < 200 || r.status >= 300) {
    console.error('[abcGroupX] createClass failed:', r.status, JSON.stringify(r.data))
    return { ok: false, event_id: null, http: r.status, error: r.data?.status?.message || r.data?.message || `HTTP ${r.status}` }
  }
  const created = r.data?.events?.[0] || r.data?.event || r.data
  return { ok: true, event_id: created?.eventId || null, http: r.status, error: null }
}

async function cancelClass(clubNumber, eventId) {
  assertClub(clubNumber)
  const r = await axios.delete(
    `${ABC_BASE_URL}/${clubNumber}/calendars/events/${encodeURIComponent(eventId)}`,
    { headers: abcHeaders(), timeout: 30000, validateStatus: () => true },
  )
  if (r.status < 200 || r.status >= 300) {
    console.error('[abcGroupX] cancelClass failed:', r.status, JSON.stringify(r.data))
    return { ok: false, http: r.status, error: r.data?.status?.message || r.data?.message || `HTTP ${r.status}` }
  }
  return { ok: true, http: r.status, error: null }
}

module.exports = {
  GX_DEPARTMENTS,
  listClassTypes, listInstructors, listClasses, createClass, cancelClass,
  _shapeClassType, _shapeInstructor, _shapeClassEvent,
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd auth && node --test src/services/abcGroupX.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/abcGroupX.js auth/src/services/abcGroupX.test.js
git commit -m "feat(auth): add ABC Group X service (class types, instructors, events)"
```

---

### Task 4: Migration 093

**Files:**
- Create: `auth/migrations/093_group_x.sql`

**Interfaces:**
- Produces: tables `group_x_series`, `group_x_class_attendance` (columns exactly as written here — Tasks 8, 10, 12 depend on these names).

- [ ] **Step 1: Confirm 093 is the next free number**

Run: `ls auth/migrations | tail -3`
Expected: highest existing is `092_meeting_notes_runs.sql`. If it is higher, use the next free number and use that number consistently everywhere below.

- [ ] **Step 2: Write the migration**

Create `auth/migrations/093_group_x.sql`:

```sql
-- Group X scheduler.
--
-- ABC owns WHAT is scheduled; these tables own HOW IT WENT plus the recurring
-- series definition. There is deliberately no local mirror of the class
-- schedule, so nothing needs reconciling when a class is edited inside ABC.
--
-- This repo has no migration runner. Apply by hand to prod Supabase after merge.

create table if not exists group_x_series (
  id                uuid primary key default gen_random_uuid(),
  club_number       text not null,
  event_type_id     text not null,
  class_name        text not null,
  employee_id       text not null,
  instructor_name   text not null,
  weekdays          smallint[] not null,   -- 0=Sun .. 6=Sat
  start_time        time not null,         -- club-local Pacific
  duration_minutes  int not null,
  training_level_id text,
  starts_on         date not null,
  ends_on           date not null,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  canceled_at       timestamptz,
  canceled_by       text
);

create index if not exists group_x_series_club_dates_idx
  on group_x_series (club_number, starts_on, ends_on);

create table if not exists group_x_class_attendance (
  club_number            text not null,
  abc_event_id           text not null,
  series_id              uuid references group_x_series(id) on delete set null,
  event_timestamp        timestamptz not null,
  event_timestamp_local  text not null,
  event_type_id          text not null,
  class_name             text not null,
  employee_id            text,
  instructor_name        text,
  max_attendees          int,
  headcount              int not null,
  notes                  text,
  recorded_by            text not null,
  recorded_at            timestamptz not null default now(),
  primary key (club_number, abc_event_id)
);

create index if not exists group_x_attendance_club_ts_idx
  on group_x_class_attendance (club_number, event_timestamp);

-- The portal DB is 100% service-role. Every public table gets RLS enabled with
-- no policy, so a leaked anon key reads nothing.
alter table group_x_series enable row level security;
alter table group_x_class_attendance enable row level security;
```

- [ ] **Step 3: Verify the SQL parses**

Do NOT apply this to prod. Confirm by eye that every column referenced in Tasks 8, 10, and 12 appears above:
`group_x_series`: id, club_number, event_type_id, class_name, employee_id, instructor_name, weekdays, start_time, duration_minutes, training_level_id, starts_on, ends_on, created_by, created_at, canceled_at, canceled_by.
`group_x_class_attendance`: club_number, abc_event_id, series_id, event_timestamp, event_timestamp_local, event_type_id, class_name, employee_id, instructor_name, max_attendees, headcount, notes, recorded_by, recorded_at.

- [ ] **Step 4: Commit**

```bash
git add auth/migrations/093_group_x.sql
git commit -m "feat(db): migration 093 group_x_series + group_x_class_attendance"
```

---

### Task 5: Admin read endpoints

**Files:**
- Create: `auth/src/routes/groupX.js`
- Modify: `auth/src/index.js`

**Interfaces:**
- Consumes: `services/abcGroupX`, `lib/groupXClubs`, `middleware/auth`, `middleware/role`.
- Produces: mounted router at `/group-x` with `GET /class-types`, `GET /instructors`, `GET /classes`.

- [ ] **Step 1: Write the router**

Create `auth/src/routes/groupX.js`:

```js
/**
 * /group-x — Group X class scheduler (admin only).
 *
 * ABC is the source of truth for what is scheduled. Supabase (group_x_series,
 * group_x_class_attendance) owns only the recurring-series definition and the
 * post-class headcount.
 *
 * Attendance is staff-entered rather than read from ABC: of 37 Salem class
 * events in July 2026, 31 had zero members attached and the rest had one, all
 * marked "Did Not Attend". Nobody books classes through ABC.
 */
const { Router } = require('express')
const abc = require('../services/abcGroupX')
const { CLUBS, isKnownClubNumber } = require('../lib/groupXClubs')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Resolves and validates club_number off the query string. Returns null and
// sends the 400 itself when invalid, so handlers can `if (!club) return`.
function requireClub(req, res) {
  const clubNumber = String(req.query.club_number || '')
  if (!clubNumber) {
    res.status(400).json({ error: 'club_number is required' })
    return null
  }
  if (!isKnownClubNumber(clubNumber)) {
    res.status(400).json({ error: 'unknown club_number' })
    return null
  }
  return clubNumber
}

function fail(res, err, where) {
  console.error(`[groupX] ${where} failed:`, err.message)
  res.status(500).json({ error: err.message })
}

router.get('/clubs', (req, res) => res.json({ clubs: CLUBS }))

router.get('/class-types', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    res.json({ class_types: await abc.listClassTypes(club) })
  } catch (err) { fail(res, err, '/class-types') }
})

router.get('/instructors', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    res.json({ instructors: await abc.listInstructors(club) })
  } catch (err) { fail(res, err, '/instructors') }
})

router.get('/classes', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  const { start, end } = req.query
  if (!DATE_RE.test(start || '') || !DATE_RE.test(end || '')) {
    return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
  }
  try {
    res.json({ classes: await abc.listClasses(club, start, end) })
  } catch (err) { fail(res, err, '/classes') }
})

module.exports = router
```

- [ ] **Step 2: Mount the router**

In `auth/src/index.js`, beside the other `app.use('/…', require('./routes/…'))` lines (near `app.use('/abc-scheduler', …)` if present, otherwise after `app.use('/tours', …)`), add:

```js
app.use('/group-x', require('./routes/groupX'))
```

- [ ] **Step 3: Verify the app boots**

Run: `cd auth && node -e "require('./src/routes/groupX'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Run the whole auth test suite**

Run: `cd auth && npm test`
Expected: all tests pass, including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add auth/src/routes/groupX.js auth/src/index.js
git commit -m "feat(auth): /group-x read endpoints (class types, instructors, classes)"
```

---

### Task 6: Manual ABC verification and PR A

**Files:** none.

This task is verification only. Do not skip it and do not report PR A as working without pasting the actual output.

- [ ] **Step 1: Verify the class catalog against live ABC**

From the repo root, with `auth/.env` loaded:

```bash
cd auth && node -e "
require('dotenv').config()
const abc = require('./src/services/abcGroupX')
abc.listClassTypes('30935').then(t => console.log(JSON.stringify(t, null, 1)))
"
```

Expected: 6 class types — Barbell Strength, Bootcamp, SMALL GROUP TRAINING, StrongHer, Yoga, Yoga SX — with numeric `duration_minutes: 60` and `max_attendees` of 10/12/15/10/10/15.

- [ ] **Step 2: Verify the instructor list**

```bash
cd auth && node -e "
require('dotenv').config()
const abc = require('./src/services/abcGroupX')
abc.listInstructors('30935').then(i => console.log(i.map(x => x.display_name + ' [' + x.department + ']').join('\n')))
"
```

Expected: Group Exercise staff listed first, then Personal Trainers. Salem should return roughly 12 people. If it returns 0, the department filter is wrong — stop and fix before continuing.

- [ ] **Step 3: Verify class reads for a real week**

```bash
cd auth && node -e "
require('dotenv').config()
const abc = require('./src/services/abcGroupX')
abc.listClasses('30935', '2026-07-27', '2026-08-02').then(c =>
  console.log(c.map(x => x.event_timestamp_local + '  ' + x.class_name + '  ' + x.instructor_name + '  ' + x.status).join('\n')))
"
```

Expected: real Salem classes, a mix of `Pending` and `Completed`, every row inside the requested week (proving the ±1 day pad is trimmed back correctly).

- [ ] **Step 4: Open PR A**

```bash
git push -u origin feat/group-x-scheduler
gh pr create --base master --title "feat(group-x): ABC service, time helpers, migration 093, read endpoints" --body "$(cat <<'EOF'
PR A of 6 for the Group X scheduler. Spec: `docs/superpowers/specs/2026-07-30-group-x-scheduler-design.md`

Read-only. No ABC writes in this PR.

- Extracts ABC's Pacific-timestamp handling out of `abcScheduler.js` into `lib/abcTime.js` (unit tested across both 2026 DST transitions) and imports it back. No PT Scheduler behavior change.
- Adds `services/abcGroupX.js`: class catalog from ABC's `/calendars/eventtypes` (never used before — the old event-type dropdown mined cached history, which is why it only ever saw SMALL GROUP TRAINING), instructors filtered to the Group Exercise + Personal Trainers departments, and class reads with no `eventStatus` filter so future `Pending` classes are visible.
- Adds migration `093_group_x.sql`. **Must be applied to prod Supabase by hand after merge** — this repo has no migration runner.
- Adds `GET /group-x/{clubs,class-types,instructors,classes}`, admin only.

Verified live against production ABC: 6 class types identical at all 7 clubs, ~12 eligible Salem instructors, real class reads for the week of Jul 27.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Do not merge. Report the PR URL.

---

# PR B — Staff calendar UI

### Task 7: Extract week-grid helpers

**Files:**
- Create: `portal/src/lib/weekGrid.js`
- Test: `portal/src/lib/weekGrid.test.js`
- Modify: `portal/src/components/admin/PtSchedulerView.jsx` (lines 15-95)

**Interfaces:**
- Produces:
  - `startOfWeek(d: Date) -> Date` — Sunday-anchored, local midnight
  - `addDays(d: Date, n: number) -> Date`
  - `toISODate(d: Date) -> string`
  - `fmtHour(h: number) -> string` e.g. `'6 AM'`
  - `fmtTime12(hour: number, min: number) -> string` e.g. `'6:30 AM'`
  - `parseLocalTimestamp(ts: string) -> Date`
  - `layoutLanes(events: Array<{start:number,end:number}>) -> Array<{lane:number,lanes:number}>`
  - `DAY_START_HOUR = 6`, `DAY_END_HOUR = 22`, `PX_PER_MINUTE = 1`, `WEEKDAY_LABELS`, `MONTH_LABELS`

- [ ] **Step 1: Read the current implementations**

Open `portal/src/components/admin/PtSchedulerView.jsx` and read lines 15-95 and the `layoutLanes` function near line 797. Copy these implementations **verbatim** into the new module — this is a move, not a rewrite. PT Scheduler is in production and must behave identically.

- [ ] **Step 2: Write the failing test**

Create `portal/src/lib/weekGrid.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { startOfWeek, addDays, toISODate, fmtHour, fmtTime12, parseLocalTimestamp, layoutLanes } from './weekGrid'

describe('weekGrid', () => {
  it('startOfWeek anchors to Sunday', () => {
    // 2026-07-30 is a Thursday; its week starts Sunday 2026-07-26.
    expect(toISODate(startOfWeek(new Date(2026, 6, 30)))).toBe('2026-07-26')
    // A Sunday is its own week start.
    expect(toISODate(startOfWeek(new Date(2026, 6, 26)))).toBe('2026-07-26')
  })

  it('addDays crosses month boundaries', () => {
    expect(toISODate(addDays(new Date(2026, 6, 31), 1))).toBe('2026-08-01')
  })

  it('fmtHour renders 12-hour labels', () => {
    expect(fmtHour(6)).toBe('6 AM')
    expect(fmtHour(12)).toBe('12 PM')
    expect(fmtHour(13)).toBe('1 PM')
  })

  it('fmtTime12 pads minutes', () => {
    expect(fmtTime12(6, 0)).toBe('6:00 AM')
    expect(fmtTime12(18, 5)).toBe('6:05 PM')
  })

  it('parseLocalTimestamp reads a naive timestamp as local, not UTC', () => {
    const d = parseLocalTimestamp('2026-07-28 10:00:00')
    expect(d.getHours()).toBe(10)
    expect(d.getDate()).toBe(28)
  })

  it('layoutLanes gives non-overlapping events a single lane', () => {
    const out = layoutLanes([{ start: 0, end: 60 }, { start: 60, end: 120 }])
    expect(out.map(o => o.lanes)).toEqual([1, 1])
  })

  it('layoutLanes splits two overlapping events into two lanes', () => {
    const out = layoutLanes([{ start: 0, end: 60 }, { start: 30, end: 90 }])
    expect(out.map(o => o.lanes)).toEqual([2, 2])
    expect(out.map(o => o.lane)).toEqual([0, 1])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd portal && npx vitest run src/lib/weekGrid.test.js`
Expected: FAIL — cannot resolve `./weekGrid`.

If vitest is not installed in `portal`, install it as a dev dependency first: `cd portal && pnpm add -D vitest`. Use pnpm, not npm.

- [ ] **Step 4: Create the module**

Create `portal/src/lib/weekGrid.js` containing the constants and functions copied verbatim in Step 1, each `export`ed. Add this header comment:

```js
// Week-grid and date helpers shared by the PT Scheduler and the Group X
// scheduler. Moved out of PtSchedulerView.jsx unchanged — PT Scheduler is in
// production and must behave identically.
//
// Note: startOfWeek is SUNDAY-anchored, matching the staff calendars. The
// public class board is Monday-anchored and deliberately does not use this.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd portal && npx vitest run src/lib/weekGrid.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 6: Point PtSchedulerView at the module**

In `portal/src/components/admin/PtSchedulerView.jsx`: delete the local definitions of `DAY_START_HOUR`, `DAY_END_HOUR`, `PX_PER_MINUTE`, `GRID_HEIGHT_PX`, `WEEKDAY_LABELS`, `MONTH_LABELS`, `startOfWeek`, `addDays`, `toISODate`, `fmtHour`, `fmtTime12`, `parseLocalTimestamp`, and `layoutLanes`, and add:

```js
import {
  DAY_START_HOUR, DAY_END_HOUR, PX_PER_MINUTE, WEEKDAY_LABELS, MONTH_LABELS,
  startOfWeek, addDays, toISODate, fmtHour, fmtTime12, parseLocalTimestamp, layoutLanes,
} from '../../lib/weekGrid'

const GRID_HEIGHT_PX = (DAY_END_HOUR - DAY_START_HOUR) * 60 * PX_PER_MINUTE
```

- [ ] **Step 7: Verify the portal still builds**

Run: `cd portal && pnpm build`
Expected: build succeeds with no unresolved-import errors.

- [ ] **Step 8: Commit**

```bash
git add portal/src/lib/weekGrid.js portal/src/lib/weekGrid.test.js portal/src/components/admin/PtSchedulerView.jsx
git commit -m "refactor(portal): extract week-grid helpers from PtSchedulerView"
```

---

### Task 8: Class create and cancel endpoints

**Files:**
- Modify: `auth/src/routes/groupX.js`

**Interfaces:**
- Consumes: `abcGroupX.createClass`, `abcGroupX.cancelClass`.
- Produces:
  - `POST /group-x/classes` body `{club_number, event_type_id, employee_id, date, time, duration_minutes, training_level_id?}` -> `201 {event_id}` or `502 {error}`
  - `DELETE /group-x/classes/:eventId?club_number=` -> `200 {ok:true}` or `502 {error}`
  - exported helper `_buildLocalTimestamp(date, time) -> string` ('YYYY-MM-DD HH:mm:ss')

- [ ] **Step 1: Write the failing test**

Create `auth/src/routes/groupX.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { _buildLocalTimestamp } = require('./groupX')

test('_buildLocalTimestamp joins date and HH:mm into an ABC timestamp', () => {
  assert.strictEqual(_buildLocalTimestamp('2026-08-03', '06:00'), '2026-08-03 06:00:00')
})

test('_buildLocalTimestamp accepts HH:mm:ss unchanged', () => {
  assert.strictEqual(_buildLocalTimestamp('2026-08-03', '06:30:00'), '2026-08-03 06:30:00')
})

test('_buildLocalTimestamp rejects a malformed time', () => {
  assert.throws(() => _buildLocalTimestamp('2026-08-03', '6am'), /invalid time/i)
})

test('_buildLocalTimestamp rejects a malformed date', () => {
  assert.throws(() => _buildLocalTimestamp('08/03/2026', '06:00'), /invalid date/i)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd auth && node --test src/routes/groupX.test.js`
Expected: FAIL — `_buildLocalTimestamp is not a function`.

- [ ] **Step 3: Add the helper and the two endpoints**

In `auth/src/routes/groupX.js`, add above `module.exports`:

```js
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/

// ABC wants a naive club-local timestamp: "YYYY-MM-DD HH:mm:ss".
function _buildLocalTimestamp(date, time) {
  if (!DATE_RE.test(String(date || ''))) throw new Error('invalid date, expected YYYY-MM-DD')
  const m = TIME_RE.exec(String(time || ''))
  if (!m) throw new Error('invalid time, expected HH:mm')
  return `${date} ${m[1]}:${m[2]}:${m[4] || '00'}`
}

router.post('/classes', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
  if (!b.event_type_id || !b.employee_id) {
    return res.status(400).json({ error: 'event_type_id and employee_id are required' })
  }
  const duration = parseInt(b.duration_minutes, 10)
  if (!duration || duration <= 0) {
    return res.status(400).json({ error: 'duration_minutes must be a positive number' })
  }

  let stamp
  try {
    stamp = _buildLocalTimestamp(b.date, b.time)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  try {
    const result = await abc.createClass(String(b.club_number), {
      event_type_id: b.event_type_id,
      employee_id: b.employee_id,
      event_timestamp_local: stamp,
      duration_minutes: duration,
      training_level_id: b.training_level_id || null,
    })
    // ABC rejected it. Surface ABC's own message rather than a generic 500 —
    // its validation errors (API-CAL-EVT-*) are the useful part.
    if (!result.ok) return res.status(502).json({ error: result.error, abc_status: result.http })
    res.status(201).json({ event_id: result.event_id })
  } catch (err) { fail(res, err, 'POST /classes') }
})

router.delete('/classes/:eventId', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  try {
    const result = await abc.cancelClass(club, req.params.eventId)
    if (!result.ok) return res.status(502).json({ error: result.error, abc_status: result.http })
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'DELETE /classes') }
})
```

Change the export to:

```js
module.exports = router
module.exports._buildLocalTimestamp = _buildLocalTimestamp
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd auth && node --test src/routes/groupX.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add auth/src/routes/groupX.js auth/src/routes/groupX.test.js
git commit -m "feat(auth): Group X single class create + cancel"
```

---

### Task 9: Group X admin view

**Files:**
- Create: `portal/src/components/groupx/GroupXView.jsx`
- Create: `portal/src/components/groupx/WeekGrid.jsx`
- Create: `portal/src/components/groupx/CreateClassModal.jsx`
- Modify: `portal/src/components/AdminPanel.jsx`

**Interfaces:**
- Consumes: `lib/api.api`, `lib/weekGrid` helpers, `/group-x/{clubs,class-types,instructors,classes}`, `POST /group-x/classes`, `DELETE /group-x/classes/:id`.
- Produces: default-exported `GroupXView` React component taking no props.

- [ ] **Step 1: Read the existing patterns**

Read `portal/src/components/admin/PtSchedulerView.jsx` for: how `api()` is called, how the club selector pill tabs are built, how the week grid renders absolutely-positioned event blocks, and how modals are structured. Match those patterns. Read `portal/src/components/AdminPanel.jsx:102-130` for the experimental-tile registration shape.

- [ ] **Step 2: Build WeekGrid.jsx**

`WeekGrid.jsx` exports `default function WeekGrid({ weekStart, classes, onClassClick, onSlotClick })`.

- 7 day columns (Sun-Sat, matching `startOfWeek`), hour rows from `DAY_START_HOUR` to `DAY_END_HOUR`.
- Each class is absolutely positioned: `top = (localHour*60 + localMin - DAY_START_HOUR*60) * PX_PER_MINUTE`, `height = duration_minutes * PX_PER_MINUTE`.
- Use `parseLocalTimestamp(c.event_timestamp_local)` for placement. Never use `event_timestamp` (UTC) for grid position.
- `layoutLanes` handles overlapping classes in the same column.
- Color each block by a stable hash of `event_type_id` so a class type keeps its color across weeks.
- Blocks show start time, class name, instructor.
- Clicking empty space calls `onSlotClick({ date, time })`; clicking a block calls `onClassClick(classEvent)`.
- Wrap the whole grid in a `bg-surface` card.

- [ ] **Step 3: Build CreateClassModal.jsx**

`export default function CreateClassModal({ club, defaultDate, defaultTime, classTypes, instructors, onClose, onCreated })`.

- Fields: class type (select, from `classTypes`), instructor (select, from `instructors`, with the department shown after the name), date, time, duration (prefilled from the selected type's `duration_minutes`), training level (select, only rendered when the selected type has more than one training level; auto-selected when there is exactly one).
- On submit: `POST /group-x/classes`. On `201`, call `onCreated()` and close.
- On non-2xx, render ABC's `error` string verbatim in a red block inside the modal. Do not swallow it — ABC's validation codes are the diagnostic.
- Disable the submit button while the request is in flight.
- `bg-surface` card. No em-dashes in any label or message.

- [ ] **Step 4: Build GroupXView.jsx**

`export default function GroupXView()`.

- State: `clubs`, `selectedClub`, `weekStart` (defaults to `startOfWeek(new Date())`), `classes`, `classTypes`, `instructors`, `loading`, `error`, `createModal`.
- On mount: `GET /group-x/clubs`, default to the first club.
- On club or week change: in parallel, `GET /group-x/classes?club_number=&start=&end=`, `GET /group-x/class-types?club_number=`, `GET /group-x/instructors?club_number=`. `start` = `toISODate(weekStart)`, `end` = `toISODate(addDays(weekStart, 6))`.
- Toolbar: club pill tabs, `‹ Prev` / `Today` / `Next ›`, the week range label, and a `+ Add class` button.
- A prominent warning card at the top: `Classes created here are written straight into ABC. This is the live club calendar.`
- Clicking a class opens a detail popover with a `Cancel class` button that confirms, then `DELETE /group-x/classes/:id?club_number=`, then reloads.
- Every block wrapped in `bg-surface`.

- [ ] **Step 5: Register the tile**

In `portal/src/components/AdminPanel.jsx`:

1. Import: `import GroupXView from './groupx/GroupXView'`
2. Add to `EXPERIMENTAL_TILES` (after the `pt-scheduler` entry):

```js
{ key: 'group-x', label: 'Group X', desc: 'Class Schedule (Beta)', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5M9 15l2 2 4-4' },
```

3. Add `'group-x'` to the `'Automation & AI'` group's `keys` array (line ~129).
4. Add the render line beside the others: `{activeSection === 'group-x' && <GroupXView />}`

- [ ] **Step 6: Verify the build**

Run: `cd portal && pnpm build`
Expected: build succeeds.

- [ ] **Step 7: Commit and open PR B**

```bash
git add portal/src/components/groupx portal/src/components/AdminPanel.jsx
git commit -m "feat(portal): Group X week calendar with single class create"
git push
gh pr create --base master --title "feat(group-x): staff week calendar + single class create" --body "PR B of 6. Adds the admin Group X week grid, single class create, and cancel. Extracts the week-grid helpers out of PtSchedulerView into portal/src/lib/weekGrid.js (verbatim move, unit tested) so both calendars share one copy.

Writes hit production ABC. Verified by creating one test class at Salem, confirming it in the ABC UI, then cancelling it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Before pushing, do the manual round-trip: create one class at Salem, confirm it appears in ABC, cancel it, confirm it is gone. Paste the result into the PR body. Do not claim it works without doing this.

---

# PR C — Recurring series

### Task 10: Occurrence expansion

**Files:**
- Create: `auth/src/lib/groupXSeries.js`
- Test: `auth/src/lib/groupXSeries.test.js`

**Interfaces:**
- Produces:
  - `MAX_OCCURRENCES = 200`
  - `expandSeries({ weekdays, start_time, starts_on, ends_on }) -> Array<{ date: string, timestamp_local: string }>`
    Throws `Error('too many occurrences: N (max 200)')` over the cap, and on invalid input.

- [ ] **Step 1: Write the failing test**

Create `auth/src/lib/groupXSeries.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { expandSeries, MAX_OCCURRENCES } = require('./groupXSeries')

const base = { weekdays: [1, 3, 5], start_time: '06:00', starts_on: '2026-08-03', ends_on: '2026-08-14' }

test('expandSeries emits one occurrence per matching weekday', () => {
  // Aug 3 2026 is a Monday. Mon/Wed/Fri over two weeks = 6.
  const out = expandSeries(base)
  assert.deepStrictEqual(out.map(o => o.date), [
    '2026-08-03', '2026-08-05', '2026-08-07',
    '2026-08-10', '2026-08-12', '2026-08-14',
  ])
})

test('expandSeries builds ABC-shaped local timestamps', () => {
  assert.strictEqual(expandSeries(base)[0].timestamp_local, '2026-08-03 06:00:00')
})

test('ends_on is inclusive', () => {
  const out = expandSeries({ ...base, weekdays: [5], starts_on: '2026-08-14', ends_on: '2026-08-14' })
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].date, '2026-08-14')
})

test('a week with no matching weekday yields nothing', () => {
  const out = expandSeries({ ...base, weekdays: [0], starts_on: '2026-08-03', ends_on: '2026-08-07' })
  assert.deepStrictEqual(out, [])
})

test('expansion spans a DST boundary without drifting the local time', () => {
  // DST ends Nov 1 2026. The local start time must stay 06:00 either side.
  const out = expandSeries({ weekdays: [1], start_time: '06:00', starts_on: '2026-10-26', ends_on: '2026-11-09' })
  assert.deepStrictEqual(out.map(o => o.timestamp_local), [
    '2026-10-26 06:00:00', '2026-11-02 06:00:00', '2026-11-09 06:00:00',
  ])
})

test('expandSeries throws over the occurrence cap', () => {
  assert.throws(
    () => expandSeries({ weekdays: [0,1,2,3,4,5,6], start_time: '06:00', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    /too many occurrences: 365 \(max 200\)/,
  )
})

test('expandSeries rejects an empty weekday set', () => {
  assert.throws(() => expandSeries({ ...base, weekdays: [] }), /at least one weekday/i)
})

test('expandSeries rejects ends_on before starts_on', () => {
  assert.throws(() => expandSeries({ ...base, starts_on: '2026-08-14', ends_on: '2026-08-03' }), /ends_on/i)
})

test('MAX_OCCURRENCES is 200', () => {
  assert.strictEqual(MAX_OCCURRENCES, 200)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd auth && node --test src/lib/groupXSeries.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `auth/src/lib/groupXSeries.js`:

```js
// Pure expansion of a recurring Group X series into individual occurrences.
// No I/O — every ABC write decision is made from this list, so it is worth
// testing hard.
//
// Dates are walked in UTC purely as calendar arithmetic; the emitted
// timestamp_local carries the club-local wall-clock time verbatim. That is why
// a series spanning a DST change keeps its 6:00 AM start on both sides: we
// never convert, we just re-attach the same wall time to each date.
const { toIsoDate } = require('./abcTime')

const MAX_OCCURRENCES = 200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/

function expandSeries({ weekdays, start_time, starts_on, ends_on }) {
  if (!Array.isArray(weekdays) || weekdays.length === 0) {
    throw new Error('at least one weekday is required')
  }
  if (weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('weekdays must be integers 0-6 (0=Sunday)')
  }
  if (!DATE_RE.test(starts_on) || !DATE_RE.test(ends_on)) {
    throw new Error('starts_on and ends_on must be YYYY-MM-DD')
  }
  if (ends_on < starts_on) throw new Error('ends_on must not be before starts_on')

  const m = TIME_RE.exec(String(start_time || ''))
  if (!m) throw new Error('start_time must be HH:mm')
  const wall = `${m[1]}:${m[2]}:${m[4] || '00'}`

  const want = new Set(weekdays)
  const out = []
  const cursor = new Date(starts_on + 'T00:00:00Z')
  const last = new Date(ends_on + 'T00:00:00Z')

  while (cursor <= last) {
    if (want.has(cursor.getUTCDay())) {
      const date = toIsoDate(cursor)
      out.push({ date, timestamp_local: `${date} ${wall}` })
      // Check inside the loop so the error reports the true count only after
      // we know it exceeds the cap, and so a runaway range cannot balloon.
      if (out.length > MAX_OCCURRENCES) {
        // Finish counting so the message is accurate and actionable.
        let n = out.length
        const probe = new Date(cursor)
        while (true) {
          probe.setUTCDate(probe.getUTCDate() + 1)
          if (probe > last) break
          if (want.has(probe.getUTCDay())) n++
        }
        throw new Error(`too many occurrences: ${n} (max ${MAX_OCCURRENCES})`)
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

module.exports = { expandSeries, MAX_OCCURRENCES }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd auth && node --test src/lib/groupXSeries.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add auth/src/lib/groupXSeries.js auth/src/lib/groupXSeries.test.js
git commit -m "feat(auth): pure recurring-series occurrence expansion"
```

---

### Task 11: Series endpoints

**Files:**
- Modify: `auth/src/routes/groupX.js`

**Interfaces:**
- Consumes: `lib/groupXSeries.expandSeries`, `abcGroupX.createClass`, `abcGroupX.cancelClass`, `services/supabase.supabaseAdmin`.
- Produces:
  - `POST /group-x/series/preview` -> `{ count, occurrences: [{date, timestamp_local}] }` — no writes
  - `POST /group-x/series` -> `201 { series_id, created, failed, occurrences: [{date, ok, event_id, error}] }`
  - `DELETE /group-x/series/:id?from=YYYY-MM-DD` -> `{ canceled, failed, results: [...] }`

- [ ] **Step 1: Add the preview endpoint**

In `auth/src/routes/groupX.js`, add the imports:

```js
const { expandSeries, MAX_OCCURRENCES } = require('../lib/groupXSeries')
const { supabaseAdmin } = require('../services/supabase')
```

and the endpoint:

```js
// Dry run. The UI calls this to show the exact date list and count before any
// ABC write. Nothing is created here.
router.post('/series/preview', (req, res) => {
  try {
    const occurrences = expandSeries(req.body || {})
    res.json({ count: occurrences.length, occurrences, max: MAX_OCCURRENCES })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})
```

- [ ] **Step 2: Add the create endpoint**

```js
router.post('/series', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
  if (!b.event_type_id || !b.employee_id || !b.class_name || !b.instructor_name) {
    return res.status(400).json({ error: 'event_type_id, employee_id, class_name, instructor_name are required' })
  }
  const duration = parseInt(b.duration_minutes, 10)
  if (!duration || duration <= 0) {
    return res.status(400).json({ error: 'duration_minutes must be a positive number' })
  }

  let occurrences
  try {
    occurrences = expandSeries(b)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  if (occurrences.length === 0) {
    return res.status(400).json({ error: 'that weekday and date range produce no classes' })
  }

  // Insert the series row FIRST. If the fan-out dies halfway, the series still
  // exists and its occurrences are still discoverable in ABC by date.
  const { data: series, error: insErr } = await supabaseAdmin
    .from('group_x_series')
    .insert({
      club_number: String(b.club_number),
      event_type_id: b.event_type_id,
      class_name: b.class_name,
      employee_id: b.employee_id,
      instructor_name: b.instructor_name,
      weekdays: b.weekdays,
      start_time: b.start_time,
      duration_minutes: duration,
      training_level_id: b.training_level_id || null,
      starts_on: b.starts_on,
      ends_on: b.ends_on,
      created_by: req.user?.email || 'unknown',
    })
    .select('id')
    .single()
  if (insErr) return fail(res, new Error(insErr.message), 'POST /series insert')

  // Sequential, not parallel. ABC is a rate-limited production API and a
  // partial failure is far easier to read in order.
  const results = []
  for (const occ of occurrences) {
    const r = await abc.createClass(String(b.club_number), {
      event_type_id: b.event_type_id,
      employee_id: b.employee_id,
      event_timestamp_local: occ.timestamp_local,
      duration_minutes: duration,
      training_level_id: b.training_level_id || null,
    })
    results.push({ date: occ.date, ok: r.ok, event_id: r.event_id, error: r.error })
  }

  const created = results.filter(r => r.ok).length
  // Report partial failure honestly. The UI shows exactly which dates failed.
  res.status(201).json({
    series_id: series.id,
    created,
    failed: results.length - created,
    occurrences: results,
  })
})
```

- [ ] **Step 3: Add the series cancel endpoint**

```js
// Cancels this series' occurrences on/after `from` (default today). Walks ABC
// for the series' date window and matches on event type + employee + local
// time, because we do not store per-occurrence ABC event ids for a series that
// was partially created.
router.delete('/series/:id', async (req, res) => {
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : new Date().toISOString().slice(0, 10)

  const { data: series, error: selErr } = await supabaseAdmin
    .from('group_x_series')
    .select('*')
    .eq('id', req.params.id)
    .single()
  if (selErr || !series) return res.status(404).json({ error: 'series not found' })

  try {
    const windowStart = from > series.starts_on ? from : series.starts_on
    if (windowStart > series.ends_on) {
      return res.json({ canceled: 0, failed: 0, results: [] })
    }
    const existing = await abc.listClasses(series.club_number, windowStart, series.ends_on)
    const wall = String(series.start_time).slice(0, 5)
    const targets = existing.filter(e =>
      e.event_type_id === series.event_type_id &&
      e.employee_id === series.employee_id &&
      String(e.event_timestamp_local || '').slice(11, 16) === wall,
    )

    const results = []
    for (const t of targets) {
      const r = await abc.cancelClass(series.club_number, t.event_id)
      results.push({ event_id: t.event_id, date: t.event_timestamp_local.slice(0, 10), ok: r.ok, error: r.error })
    }

    await supabaseAdmin
      .from('group_x_series')
      .update({ canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' })
      .eq('id', series.id)

    const canceled = results.filter(r => r.ok).length
    res.json({ canceled, failed: results.length - canceled, results })
  } catch (err) { fail(res, err, 'DELETE /series') }
})
```

- [ ] **Step 4: Verify the router still loads**

Run: `cd auth && node -e "require('./src/routes/groupX'); console.log('ok')" && node --test src/`
Expected: `ok`, then all tests pass.

- [ ] **Step 5: Commit**

```bash
git add auth/src/routes/groupX.js
git commit -m "feat(auth): Group X recurring series create, preview, cancel"
```

---

### Task 12: Series builder UI

**Files:**
- Create: `portal/src/components/groupx/CreateSeriesModal.jsx`
- Modify: `portal/src/components/groupx/GroupXView.jsx`

**Interfaces:**
- Consumes: `POST /group-x/series/preview`, `POST /group-x/series`.
- Produces: default-exported `CreateSeriesModal({ club, classTypes, instructors, onClose, onCreated })`.

- [ ] **Step 1: Build the modal — step 1 of 3, the form**

Fields: class type, instructor, weekday toggle buttons (Sun-Sat), start time, duration (prefilled from the type), start date, end date. A `Preview N classes` button.

- [ ] **Step 2: Build step 2 of 3, confirmation**

On preview, `POST /group-x/series/preview` and render:

- The count in large type.
- The full scrollable list of every date.
- A warning card: `This creates N real classes on the ABC calendar. Cancelling them afterward is one click per class.`
- A `Create N classes` button and a `Back` button.

If preview returns 400, show the error (over-cap, empty weekday set, inverted range) and stay on step 1.

- [ ] **Step 3: Build step 3 of 3, the result**

On submit, `POST /group-x/series`, disable the button, and show a progress note (`Creating N classes in ABC. This takes a moment.`).

Render the response honestly:
- All succeeded: `Created N classes.` and a `Done` button that calls `onCreated()`.
- Partial: `Created X of N. Y failed.` followed by a table of only the failed dates and ABC's error for each. Do not present a partial result as success.

- [ ] **Step 4: Wire it into GroupXView**

Add an `+ Add recurring series` button beside `+ Add class`. On `onCreated`, reload the week.

- [ ] **Step 5: Verify the build**

Run: `cd portal && pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Commit and open PR C**

```bash
git add portal/src/components/groupx auth/src/routes/groupX.js
git commit -m "feat(portal): Group X recurring series builder"
git push
gh pr create --base master --title "feat(group-x): recurring class series" --body "PR C of 6. Weekly recurring series that fan out into real ABC events.

- Pure occurrence expansion in \`lib/groupXSeries.js\`, unit tested including a DST-spanning range (local start time must not drift) and the 200-occurrence cap.
- \`POST /series/preview\` is a dry run: the UI shows the exact count and every date, and requires confirmation, before any ABC write.
- Fan-out is sequential, not parallel. ABC is rate-limited and ordered failures are readable.
- Partial failure is reported as partial failure: \"created 34 of 39\" plus the failing dates and ABC's error, never as success.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

# PR D — Attendance

### Task 13: Attendance endpoint and join

**Files:**
- Modify: `auth/src/routes/groupX.js`

**Interfaces:**
- Produces:
  - `PUT /group-x/classes/:eventId/attendance` body `{club_number, headcount, notes?, series_id?, event_timestamp, event_timestamp_local, event_type_id, class_name, employee_id?, instructor_name?, max_attendees?}` -> `{ok:true}`
  - `GET /group-x/classes` gains `headcount: number|null` and `needs_attendance: boolean` per class.

- [ ] **Step 1: Add the attendance upsert**

In `auth/src/routes/groupX.js`:

```js
router.put('/classes/:eventId/attendance', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
  const headcount = parseInt(b.headcount, 10)
  if (!Number.isInteger(headcount) || headcount < 0) {
    return res.status(400).json({ error: 'headcount must be a non-negative whole number' })
  }
  if (!b.event_timestamp || !b.event_timestamp_local || !b.event_type_id || !b.class_name) {
    return res.status(400).json({ error: 'event_timestamp, event_timestamp_local, event_type_id, class_name are required' })
  }

  // Whole row. A partial upsert fails NOT NULL columns even when the row
  // already exists, which has broken syncs here before.
  const row = {
    club_number: String(b.club_number),
    abc_event_id: req.params.eventId,
    series_id: b.series_id || null,
    event_timestamp: b.event_timestamp,
    event_timestamp_local: b.event_timestamp_local,
    event_type_id: b.event_type_id,
    class_name: b.class_name,
    employee_id: b.employee_id || null,
    instructor_name: b.instructor_name || null,
    max_attendees: b.max_attendees ?? null,
    headcount,
    notes: b.notes || null,
    recorded_by: req.user?.email || 'unknown',
    recorded_at: new Date().toISOString(),
  }

  const { error } = await supabaseAdmin
    .from('group_x_class_attendance')
    .upsert(row, { onConflict: 'club_number,abc_event_id' })
  if (error) return fail(res, new Error(error.message), 'PUT /attendance')
  res.json({ ok: true })
})
```

- [ ] **Step 2: Join attendance into GET /classes**

Replace the `GET /classes` handler body with:

```js
router.get('/classes', async (req, res) => {
  const club = requireClub(req, res); if (!club) return
  const { start, end } = req.query
  if (!DATE_RE.test(start || '') || !DATE_RE.test(end || '')) {
    return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
  }
  try {
    const classes = await abc.listClasses(club, start, end)
    const ids = classes.map(c => c.event_id)
    let byId = new Map()
    if (ids.length) {
      const { data, error } = await supabaseAdmin
        .from('group_x_class_attendance')
        .select('abc_event_id, headcount, notes, recorded_by, recorded_at')
        .eq('club_number', club)
        .in('abc_event_id', ids)
      if (error) throw new Error(error.message)
      byId = new Map((data || []).map(r => [r.abc_event_id, r]))
    }
    const nowIso = new Date().toISOString()
    res.json({
      classes: classes.map(c => {
        const a = byId.get(c.event_id) || null
        return {
          ...c,
          headcount: a ? a.headcount : null,
          notes: a ? a.notes : null,
          recorded_by: a ? a.recorded_by : null,
          // Past and never logged. Drives the needs-attendance strip.
          needs_attendance: !a && !!c.event_timestamp && c.event_timestamp < nowIso,
        }
      }),
    })
  } catch (err) { fail(res, err, '/classes') }
})
```

- [ ] **Step 3: Verify**

Run: `cd auth && node -e "require('./src/routes/groupX'); console.log('ok')" && node --test src/`
Expected: `ok`, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/groupX.js
git commit -m "feat(auth): Group X headcount upsert + attendance join on class reads"
```

---

### Task 14: Attendance UI

**Files:**
- Create: `portal/src/components/groupx/AttendanceModal.jsx`
- Modify: `portal/src/components/groupx/GroupXView.jsx`
- Modify: `portal/src/components/groupx/WeekGrid.jsx`

- [ ] **Step 1: Build AttendanceModal.jsx**

`export default function AttendanceModal({ club, classEvent, onClose, onSaved })`.

- Header: class name, local date and time, instructor.
- A large number input for headcount, an optional notes textarea.
- If `max_attendees` is known, show `of N spots` beside the input and, once a number is typed, the live fill percentage.
- Submit `PUT /group-x/classes/:eventId/attendance` with the whole payload from `classEvent` plus `headcount` and `notes`.
- If a headcount is already recorded, prefill it and label the button `Update` rather than `Save`.
- `bg-surface` card, no em-dashes.

- [ ] **Step 2: Add the needs-attendance strip to GroupXView**

Above the grid, when any loaded class has `needs_attendance`, render a `bg-surface` card:

`N classes this week need an attendance count` followed by a compact clickable list (date, time, class, instructor). Clicking one opens `AttendanceModal`.

When none need attendance, render nothing at all. Do not render a card saying everything is logged.

- [ ] **Step 3: Badge the grid blocks**

In `WeekGrid.jsx`: a class with `needs_attendance` gets a small amber dot and a `?` marker; a class with a `headcount` shows the number in the corner of the block.

- [ ] **Step 4: Verify the build**

Run: `cd portal && pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit and open PR D**

```bash
git add portal/src/components/groupx auth/src/routes/groupX.js
git commit -m "feat(portal): Group X attendance logging"
git push
gh pr create --base master --title "feat(group-x): class attendance headcounts" --body "PR D of 6. Post-class headcount logging into Supabase.

ABC attendance is unusable for this: of 37 Salem class events in July 2026, 31 had zero members attached and the rest had one, all marked \"Did Not Attend\". Nobody books classes through ABC, so the headcount is staff-entered.

- \`PUT /group-x/classes/:eventId/attendance\` upserts a whole row (a partial upsert fails NOT NULL columns even on an existing row).
- \`GET /group-x/classes\` now joins the headcount and flags past-and-unlogged classes.
- Needs-attendance strip renders only when something actually needs attention.

**Requires migration 093 to be applied to prod Supabase.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

# PR E — Public class board

### Task 15: Public payload shaping

**Files:**
- Create: `auth/src/lib/groupXPublic.js`
- Test: `auth/src/lib/groupXPublic.test.js`

**Interfaces:**
- Produces:
  - `mondayOf(isoDate: string) -> string` — the Monday of that date's week
  - `currentPacificDate() -> string` — today's 'YYYY-MM-DD' in club-local Pacific
  - `toPublicClass(c) -> { time, time_label, class_name, instructor, duration_minutes }`
  - `buildWeek(mondayIso, classes) -> { week_start, week_end, days: [{ date, weekday, label, classes: [...] }] }`

- [ ] **Step 1: Write the failing test**

Create `auth/src/lib/groupXPublic.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { mondayOf, toPublicClass, buildWeek } = require('./groupXPublic')

const CLASS = {
  event_id: 'evt1',
  event_type_id: 'type1',
  class_name: 'Bootcamp',
  event_timestamp: '2026-07-28T13:00:00.000Z',
  event_timestamp_local: '2026-07-28 06:00:00',
  status: 'Pending',
  duration_minutes: 60,
  max_attendees: 12,
  employee_id: 'emp1',
  instructor_name: 'Matthew Astley',
  headcount: 9,
}

test('mondayOf returns the Monday of that week', () => {
  assert.strictEqual(mondayOf('2026-07-30'), '2026-07-27') // Thursday -> Monday
  assert.strictEqual(mondayOf('2026-07-27'), '2026-07-27') // Monday -> itself
  assert.strictEqual(mondayOf('2026-08-02'), '2026-07-27') // Sunday -> previous Monday
})

test('toPublicClass shortens the instructor to first name + last initial', () => {
  assert.strictEqual(toPublicClass(CLASS).instructor, 'Matthew A.')
})

test('toPublicClass formats a 12-hour time label', () => {
  const p = toPublicClass(CLASS)
  assert.strictEqual(p.time, '06:00')
  assert.strictEqual(p.time_label, '6:00 AM')
})

test('toPublicClass leaks no member, staff, or business data', () => {
  const p = toPublicClass(CLASS)
  assert.deepStrictEqual(
    Object.keys(p).sort(),
    ['class_name', 'duration_minutes', 'instructor', 'time', 'time_label'],
  )
  const json = JSON.stringify(p)
  assert.ok(!json.includes('emp1'), 'employee_id must not leak')
  assert.ok(!json.includes('evt1'), 'event_id must not leak')
  assert.ok(!json.includes('9'), 'headcount must not leak')
})

test('toPublicClass handles a missing instructor', () => {
  assert.strictEqual(toPublicClass({ ...CLASS, instructor_name: null }).instructor, null)
})

test('buildWeek produces seven Monday-first days', () => {
  const w = buildWeek('2026-07-27', [CLASS])
  assert.strictEqual(w.week_start, '2026-07-27')
  assert.strictEqual(w.week_end, '2026-08-02')
  assert.strictEqual(w.days.length, 7)
  assert.deepStrictEqual(w.days.map(d => d.weekday), ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])
})

test('buildWeek files each class under its local date and sorts by time', () => {
  const later = { ...CLASS, event_timestamp_local: '2026-07-28 18:00:00', class_name: 'Yoga' }
  const w = buildWeek('2026-07-27', [later, CLASS])
  const tue = w.days.find(d => d.date === '2026-07-28')
  assert.deepStrictEqual(tue.classes.map(c => c.class_name), ['Bootcamp', 'Yoga'])
  assert.strictEqual(w.days.find(d => d.date === '2026-07-27').classes.length, 0)
})

test('buildWeek drops classes outside the week', () => {
  const w = buildWeek('2026-07-27', [{ ...CLASS, event_timestamp_local: '2026-09-01 06:00:00' }])
  assert.strictEqual(w.days.reduce((n, d) => n + d.classes.length, 0), 0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd auth && node --test src/lib/groupXPublic.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `auth/src/lib/groupXPublic.js`:

```js
// Shaping for the PUBLIC class board. This module is the boundary between
// internal data and an unauthenticated endpoint: whatever it returns is
// world-readable, so it builds an allowlisted object rather than deleting
// fields off the internal one.
//
// Weeks here are MONDAY-first, unlike the staff calendars (Sunday-first).
const { toIsoDate } = require('./abcTime')

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function mondayOf(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  // getUTCDay: 0=Sun..6=Sat. Shift so Monday is 0.
  const offset = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  return toIsoDate(d)
}

// Today in club-local Pacific. The board must roll to a new week at local
// midnight Monday, not at UTC midnight.
function currentPacificDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function time12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

// Members see a first name and a last initial. No full staff names, no ids.
function shortenName(full) {
  if (!full) return null
  const parts = String(full).trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

function toPublicClass(c) {
  const hhmm = String(c.event_timestamp_local || '').slice(11, 16)
  return {
    time: hhmm,
    time_label: time12(hhmm),
    class_name: c.class_name,
    instructor: shortenName(c.instructor_name),
    duration_minutes: c.duration_minutes,
  }
}

function buildWeek(mondayIso, classes) {
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayIso + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    const date = toIsoDate(d)
    days.push({
      date,
      weekday: WEEKDAY_LABELS[i],
      label: `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`,
      classes: (classes || [])
        .filter(c => String(c.event_timestamp_local || '').slice(0, 10) === date)
        .sort((a, b) => String(a.event_timestamp_local).localeCompare(String(b.event_timestamp_local)))
        .map(toPublicClass),
    })
  }
  const end = new Date(mondayIso + 'T00:00:00Z')
  end.setUTCDate(end.getUTCDate() + 6)
  return { week_start: mondayIso, week_end: toIsoDate(end), days }
}

module.exports = { mondayOf, currentPacificDate, toPublicClass, buildWeek, WEEKDAY_LABELS, MONTH_LABELS }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd auth && node --test src/lib/groupXPublic.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add auth/src/lib/groupXPublic.js auth/src/lib/groupXPublic.test.js
git commit -m "feat(auth): public class board payload shaping"
```

---

### Task 16: Public router and CORS ordering

**Files:**
- Create: `auth/src/routes/publicGroupX.js`
- Create: `auth/src/templates/groupXBoard.js`
- Modify: `auth/src/index.js`

**Interfaces:**
- Consumes: `lib/groupXPublic`, `lib/groupXClubs.clubBySlug`, `abcGroupX.listClasses`, `memoryCache.wrapSWR`.
- Produces: `GET /public/group-x/schedule?club=&week=`, `GET /public/group-x/board?club=`, and `renderBoardHtml({ club, weekStart })`.

- [ ] **Step 1: Write the router**

Create `auth/src/routes/publicGroupX.js`:

```js
/**
 * /public/group-x — UNAUTHENTICATED class board feed.
 *
 * Consumed by the WCS website (iframe) and by the in-gym TVs. Seven TVs polling
 * live would hammer ABC, so every read goes through a stale-while-revalidate
 * cache: fresh for 5 minutes, then served stale while it refreshes in the
 * background, and still served for an hour after that if ABC is down. A stale
 * schedule beats a blank TV.
 *
 * The club slug is an allowlist, not a passthrough: an unknown slug 404s rather
 * than letting an anonymous caller proxy an arbitrary club number through our
 * ABC credentials.
 */
const { Router } = require('express')
const abc = require('../services/abcGroupX')
const cache = require('../services/memoryCache')
const { clubBySlug } = require('../lib/groupXClubs')
const { mondayOf, currentPacificDate, buildWeek } = require('../lib/groupXPublic')
const { renderBoardHtml } = require('../templates/groupXBoard')

const router = Router()

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function loadWeek(club, monday) {
  return cache.wrapSWR(`gx:public:${club.clubNumber}:${monday}`, FRESH_MS, STALE_MS, async () => {
    const sunday = buildWeek(monday, []).week_end
    const classes = await abc.listClasses(club.clubNumber, monday, sunday)
    return { club: club.name, club_slug: club.slug, ...buildWeek(monday, classes) }
  })
}

function resolve(req, res) {
  const club = clubBySlug(req.query.club)
  if (!club) {
    res.status(404).json({ error: 'unknown club' })
    return null
  }
  const week = DATE_RE.test(req.query.week || '') ? req.query.week : currentPacificDate()
  return { club, monday: mondayOf(week) }
}

router.get('/schedule', async (req, res) => {
  const r = resolve(req, res); if (!r) return
  try {
    res.set('Cache-Control', 'public, max-age=300')
    res.json(await loadWeek(r.club, r.monday))
  } catch (err) {
    console.error('[publicGroupX] /schedule failed:', err.message)
    res.status(503).json({ error: 'schedule temporarily unavailable' })
  }
})

router.get('/board', async (req, res) => {
  const r = resolve(req, res)
  if (!r) return res.status(404).type('html').send('<h1>Unknown club</h1>')
  res.set('Cache-Control', 'public, max-age=300')
  res.type('html').send(renderBoardHtml({ clubSlug: r.club.slug, clubName: r.club.name }))
})

module.exports = router
```

- [ ] **Step 2: Mount with CORS ordering**

In `auth/src/index.js`, insert this **immediately before** the existing `app.use(cors({...}))` block at line 20:

```js
// The global CORS below is locked to ALLOWED_ORIGINS and is mounted with no
// path, so it answers OPTIONS preflight for EVERY url. The public class board
// is embedded on westcoaststrength.com, so its permissive CORS has to be
// mounted FIRST or preflight fails. This exact ordering bug has bitten the
// prospects repo before.
app.use('/public/group-x', cors({ origin: '*', methods: ['GET'] }))
```

Then, beside the other route mounts, add:

```js
app.use('/public/group-x', require('./routes/publicGroupX'))
```

- [ ] **Step 3: Verify the ordering by reading it back**

Run: `grep -n "cors\|public/group-x" auth/src/index.js | head -20`
Expected: the `/public/group-x` cors line appears at a LOWER line number than the global `app.use(cors({`. If not, move it.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/publicGroupX.js auth/src/index.js
git commit -m "feat(auth): public Group X schedule endpoint with SWR cache"
```

---

### Task 17: The board page

**Files:**
- Create: `auth/src/templates/groupXBoard.js`

**Interfaces:**
- Produces: `renderBoardHtml({ clubSlug, clubName }) -> string` — one complete HTML document.

- [ ] **Step 1: Load the design skill**

Before writing this, invoke the `frontend-design` skill. This page is going on a wall in seven gyms and on the public website; it should not read as a templated default.

- [ ] **Step 2: Write the template**

Create `auth/src/templates/groupXBoard.js` exporting `renderBoardHtml({ clubSlug, clubName })`.

Hard requirements:

- **Self-contained.** Inlined CSS and JS. No external fonts, no CDN, no build step. The only network call is to its own `/public/group-x/schedule?club=<slug>`.
- **Monday to Sunday, 7 columns**, all visible at once. Today's column is visually highlighted.
- **Each class block:** start time, class name, instructor. Nothing else.
- **Auto-refresh every 5 minutes** via `setInterval`.
- **Week derived from the client clock on every refresh**, so a TV left running for months rolls to the new week by itself at local midnight Monday. Do not bake the week into the HTML at render time.
- **Fetch failure keeps the last good render on screen.** Never blank the board on a failed poll.
- **Branding:** WCS navy and red, system font stack, `${clubName}` and the week range in the header.
- **Responsive:** legible at 1080p and 4K from across a gym floor; below roughly 900px the 7-column grid becomes a stacked day list for the website iframe.
- **A day with no classes renders as an empty column.** No "no classes today" text.
- **No em-dashes** anywhere in the visible copy.

- [ ] **Step 3: Verify the endpoint end to end**

Start the API locally and hit both routes:

```bash
cd auth && node src/index.js &
sleep 3
curl -s "http://localhost:3001/public/group-x/schedule?club=salem" | head -c 600
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/public/group-x/board?club=salem"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/public/group-x/schedule?club=portland"
```

Expected: real Salem classes in the JSON for the current week; `200` for the board; `404` for the unknown club.

- [ ] **Step 4: Verify the payload leaks nothing**

Run: `curl -s "http://localhost:3001/public/group-x/schedule?club=salem" | grep -ciE "employee_id|event_id|headcount|member"`
Expected: `0`.

- [ ] **Step 5: Look at the page**

Open `http://localhost:3001/public/group-x/board?club=salem` in a browser. Check it at 1920x1080 and at a narrow width. Take a screenshot for the PR.

- [ ] **Step 6: Commit and open PR E**

```bash
git add auth/src/templates/groupXBoard.js
git commit -m "feat(auth): public Group X class board page"
git push
gh pr create --base master --title "feat(group-x): public class board for website + TVs" --body "PR E of 6. One URL that serves both the website embed and the in-gym TVs.

- \`GET /public/group-x/board?club=salem\` returns a self-contained HTML page: inlined CSS/JS, no build step, no external requests. iframe it on the website, point a TV browser at it directly.
- Monday to Sunday, all 7 columns visible, today highlighted. The week is re-derived from the client clock on every refresh, so a TV left running rolls over by itself at local midnight Monday.
- \`GET /public/group-x/schedule?club=&week=\` is the JSON behind it, stale-while-revalidate cached (fresh 5 min, served stale up to an hour) so seven TVs polling do not hammer ABC. A failed poll keeps the last good render on screen.
- Public CORS is mounted BEFORE the global CORS. The global one is path-less and locked to ALLOWED_ORIGINS, so it would otherwise answer preflight for every url and break the website embed.
- Club slug is an allowlist. Unknown slugs 404 rather than proxying an arbitrary club number through our ABC credentials.
- Payload is allowlisted, not filtered: time, class name, instructor first name + last initial, duration. Unit tested to assert no event ids, employee ids, headcounts, or member data.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

# PR F — Performance report

### Task 18: Report aggregation

**Files:**
- Create: `auth/src/lib/groupXReport.js`
- Test: `auth/src/lib/groupXReport.test.js`

**Interfaces:**
- Produces: `aggregate(rows) -> { by_class, by_instructor, by_weekday, by_time_bucket, totals }` where each bucket entry is `{ key, sessions, total_attendees, avg_headcount, fill_rate }` and `fill_rate` is `null` when no row in the bucket has `max_attendees`.

- [ ] **Step 1: Write the failing test**

Create `auth/src/lib/groupXReport.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { aggregate } = require('./groupXReport')

const rows = [
  { class_name: 'Bootcamp', instructor_name: 'Matthew Astley', event_timestamp_local: '2026-07-27 06:00:00', headcount: 10, max_attendees: 12 },
  { class_name: 'Bootcamp', instructor_name: 'Matthew Astley', event_timestamp_local: '2026-07-29 06:00:00', headcount: 8, max_attendees: 12 },
  { class_name: 'Yoga', instructor_name: 'Jane Doe', event_timestamp_local: '2026-07-28 18:00:00', headcount: 3, max_attendees: 10 },
]

test('aggregate rolls up per class with avg headcount and fill rate', () => {
  const r = aggregate(rows)
  const bootcamp = r.by_class.find(c => c.key === 'Bootcamp')
  assert.strictEqual(bootcamp.sessions, 2)
  assert.strictEqual(bootcamp.total_attendees, 18)
  assert.strictEqual(bootcamp.avg_headcount, 9)
  assert.strictEqual(bootcamp.fill_rate, 0.75) // 18 / (12*2)
})

test('aggregate sorts by_class by avg headcount descending', () => {
  assert.deepStrictEqual(aggregate(rows).by_class.map(c => c.key), ['Bootcamp', 'Yoga'])
})

test('aggregate returns null fill_rate when capacity is unknown', () => {
  const r = aggregate([{ class_name: 'Mystery', instructor_name: 'X', event_timestamp_local: '2026-07-27 06:00:00', headcount: 5, max_attendees: null }])
  assert.strictEqual(r.by_class[0].fill_rate, null)
  assert.strictEqual(r.by_class[0].avg_headcount, 5)
})

test('aggregate omits buckets with no logged sessions entirely', () => {
  const r = aggregate(rows)
  // Only Mon/Tue/Wed have data; the other four weekdays must not appear at all.
  assert.deepStrictEqual(r.by_weekday.map(d => d.key).sort(), ['Mon', 'Tue', 'Wed'])
  assert.ok(!r.by_weekday.some(d => d.sessions === 0))
})

test('aggregate buckets by time of day', () => {
  const r = aggregate(rows)
  const keys = r.by_time_bucket.map(b => b.key)
  assert.ok(keys.includes('Morning (5a-11a)'))
  assert.ok(keys.includes('Evening (4p-9p)'))
})

test('aggregate on an empty set returns empty buckets, not zeros', () => {
  const r = aggregate([])
  assert.deepStrictEqual(r.by_class, [])
  assert.deepStrictEqual(r.by_instructor, [])
  assert.strictEqual(r.totals.sessions, 0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd auth && node --test src/lib/groupXReport.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `auth/src/lib/groupXReport.js`:

```js
// Pure aggregation over group_x_class_attendance rows.
//
// Two rules from how WCS reads reports:
//  * A bucket with no logged sessions is omitted entirely. We never render a
//    row stating a class or instructor had nothing.
//  * fill_rate is null, not 0 and not a guess, when no row in the bucket knows
//    its capacity. A dash is honest; a fabricated percentage is not.
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const TIME_BUCKETS = [
  { key: 'Early (before 5a)', from: 0, to: 5 },
  { key: 'Morning (5a-11a)', from: 5, to: 11 },
  { key: 'Midday (11a-4p)', from: 11, to: 16 },
  { key: 'Evening (4p-9p)', from: 16, to: 21 },
  { key: 'Late (9p+)', from: 21, to: 24 },
]

function hourOf(row) {
  return parseInt(String(row.event_timestamp_local || '').slice(11, 13), 10)
}

function bucketBy(rows, keyFn) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    if (key === null || key === undefined) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()]
    .map(([key, rs]) => {
      const sessions = rs.length
      const total = rs.reduce((n, r) => n + (r.headcount || 0), 0)
      const withCap = rs.filter(r => r.max_attendees > 0)
      const capacity = withCap.reduce((n, r) => n + r.max_attendees, 0)
      const attendedWithCap = withCap.reduce((n, r) => n + (r.headcount || 0), 0)
      return {
        key,
        sessions,
        total_attendees: total,
        avg_headcount: Math.round((total / sessions) * 100) / 100,
        fill_rate: capacity > 0 ? Math.round((attendedWithCap / capacity) * 10000) / 10000 : null,
      }
    })
    .sort((a, b) => b.avg_headcount - a.avg_headcount)
}

function aggregate(rows) {
  const list = rows || []
  const sessions = list.length
  const total = list.reduce((n, r) => n + (r.headcount || 0), 0)
  return {
    by_class: bucketBy(list, r => r.class_name),
    by_instructor: bucketBy(list, r => r.instructor_name),
    by_weekday: bucketBy(list, r => {
      const d = String(r.event_timestamp_local || '').slice(0, 10)
      if (!d) return null
      return WEEKDAY_LABELS[new Date(d + 'T00:00:00Z').getUTCDay()]
    }),
    by_time_bucket: bucketBy(list, r => {
      const h = hourOf(r)
      if (Number.isNaN(h)) return null
      return (TIME_BUCKETS.find(b => h >= b.from && h < b.to) || {}).key || null
    }),
    totals: {
      sessions,
      total_attendees: total,
      avg_headcount: sessions ? Math.round((total / sessions) * 100) / 100 : 0,
    },
  }
}

module.exports = { aggregate, TIME_BUCKETS, WEEKDAY_LABELS }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd auth && node --test src/lib/groupXReport.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add auth/src/lib/groupXReport.js auth/src/lib/groupXReport.test.js
git commit -m "feat(auth): Group X class performance aggregation"
```

---

### Task 19: Report endpoint and UI

**Files:**
- Modify: `auth/src/routes/groupX.js`
- Create: `portal/src/components/groupx/GroupXReport.jsx`
- Modify: `portal/src/components/groupx/GroupXView.jsx`

**Interfaces:**
- Produces: `GET /group-x/report?club_number=&start=&end=` -> the `aggregate()` shape plus `{ club_number, start, end }`. `club_number=all` aggregates every club.

- [ ] **Step 1: Add the endpoint**

In `auth/src/routes/groupX.js`, add `const { aggregate } = require('../lib/groupXReport')` and:

```js
router.get('/report', async (req, res) => {
  const clubParam = String(req.query.club_number || '')
  const isAll = clubParam === 'all'
  if (!isAll && !isKnownClubNumber(clubParam)) {
    return res.status(400).json({ error: 'club_number must be a known club or "all"' })
  }
  const { start, end } = req.query
  if (!DATE_RE.test(start || '') || !DATE_RE.test(end || '')) {
    return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
  }
  try {
    let q = supabaseAdmin
      .from('group_x_class_attendance')
      .select('club_number, class_name, instructor_name, event_timestamp_local, headcount, max_attendees')
      .gte('event_timestamp_local', `${start} 00:00:00`)
      .lte('event_timestamp_local', `${end} 23:59:59`)
      .limit(20000)
    if (!isAll) q = q.eq('club_number', clubParam)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    res.json({ club_number: clubParam, start, end, ...aggregate(data || []) })
  } catch (err) { fail(res, err, '/report') }
})
```

- [ ] **Step 2: Build GroupXReport.jsx**

`export default function GroupXReport({ clubs })`.

- Club selector including an `All Clubs` option, plus quick date ranges (This Month, Last Month, Last 90 Days, YTD) and custom date pickers, matching the existing reporting UI conventions.
- Four `bg-surface` cards: By Class, By Instructor, By Day of Week, By Time of Day. Each is a table: name, sessions, total attendees, avg headcount, fill rate.
- Fill rate renders as a percentage, or an en-dash character when `null`. Never render `0%` for unknown capacity.
- If a bucket array is empty, render nothing for that card at all.
- Top summary: total sessions, total attendees, overall avg headcount.
- No em-dashes in any copy.

- [ ] **Step 3: Wire it into GroupXView**

Add a `Calendar` / `Performance` tab toggle at the top of `GroupXView`. `Performance` renders `<GroupXReport clubs={clubs} />`.

- [ ] **Step 4: Verify**

Run: `cd auth && node --test src/ && cd ../portal && pnpm build`
Expected: all auth tests pass, portal build succeeds.

- [ ] **Step 5: Commit and open PR F**

```bash
git add auth/src/routes/groupX.js auth/src/lib/groupXReport.js auth/src/lib/groupXReport.test.js portal/src/components/groupx
git commit -m "feat(group-x): class performance report"
git push
gh pr create --base master --title "feat(group-x): class performance report" --body "PR F of 6. Answers which classes are worth keeping.

Avg headcount and fill rate sliced by class, instructor, day of week, and time of day, per club or across all clubs.

- Classes and instructors with no logged attendance in the range are omitted entirely, never shown as empty rows.
- fill_rate is null (rendered as a dash) when no session in a bucket knows its capacity, rather than a fabricated 0%.

**Requires migration 093 to be applied to prod Supabase.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Post-merge operational checklist

Not code. These must happen after the PRs merge or the feature does not work in production.

- [ ] Apply `auth/migrations/093_group_x.sql` to prod Supabase by hand. Nothing in PRs D or F works until this is done.
- [ ] Confirm `wcs-auth-api` redeployed on Render and `/group-x/clubs` returns 7 clubs.
- [ ] Tag the real Group Exercise instructors in ABC per club. Only 1-2 staff per club carry that department today.
- [ ] Add the board iframe to the WordPress site (`wcs-custom` theme), one per location page.
- [ ] Point each gym's TV browser at `https://wcs-auth-api.onrender.com/public/group-x/board?club=<slug>`.

## Self-review notes

Spec coverage checked section by section:

| Spec section | Covered by |
|---|---|
| ABC findings / class catalog | Task 3, verified in Task 6 |
| Instructor department filter | Task 3, verified in Task 6 |
| abcTime / weekGrid extraction | Tasks 1, 7 |
| Data model + RLS | Task 4 |
| Admin read endpoints | Task 5 |
| Single class create/cancel | Tasks 8, 9 |
| Recurring series + cap + partial failure | Tasks 10, 11, 12 |
| Attendance headcount | Tasks 13, 14 |
| Public board + CORS ordering + cache | Tasks 15, 16, 17 |
| Reporting + omit-empty + null fill rate | Tasks 18, 19 |
| Manual ABC verification before writes | Task 6 Step 1-3, Task 9 Step 7 |
