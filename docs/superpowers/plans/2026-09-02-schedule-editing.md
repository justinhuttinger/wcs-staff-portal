# Schedule Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff edit a scheduled Group X class or Courts & Pool event — class, instructor, day, time, and length — for one occurrence or for every occurrence from that one onward, from a modal on the calendar.

**Architecture:** Courts & Pool events are portal-owned rows, so editing is an UPDATE (or a replace, when the weekday set changes). Group X classes live in ABC, which has no event-update endpoint, so an edit is create-then-cancel and the event id changes. That requires a new local link table recording which ABC classes a series created, because migration 093 deliberately kept no mirror of the ABC schedule.

**Tech Stack:** Node 20 / Express / Supabase (service-role) in `auth/`; React 19 / Vite 8 / Tailwind 4 in `portal/`. Tests are `node:test` files alongside source, run with `npm test` (`node --test src/`) from `auth/`.

**Spec:** `docs/superpowers/specs/2026-09-02-schedule-editing-design.md`

## Global Constraints

- **Editing is offered on today-and-later occurrences only.** Past classes keep the current read-only popover. This is load-bearing: it is why a rebuild can never lose a logged headcount.
- **Group X length is never editable.** ABC ignores `duration` on create and 405s every event-type write. The read-only Length box in `CreateClassModal` stays read-only.
- **Group X saves create before they cancel.** Never cancel an ABC class until its replacement has come back with an id.
- **ABC writes are sequential, never parallel.** ABC is a rate-limited production API; an ordered failure list is what a human can act on.
- **Partial failure is reported as partial failure**, with ABC's own error message per date. Never dressed up as success.
- **`invalidatePublicBoard` / `invalidateBoard` must be called for every affected date**, or the TV boards serve a stale week for up to 5 minutes.
- **No migration runner.** Migration 182 is applied by hand to prod Supabase at merge of PR 1. RLS enabled, no policy, matching every table in this schema.
- **Do not change `startOfWeek`** in `portal/src/lib/weekGrid.js`. PT Scheduler shares it and is in production.
- **Each PR is separate** (`separate_pr_per_concern`), opened not merged (`dont_auto_merge`), and once open the branch is frozen (`never_push_to_open_pr`).

---

# PR 1 — Series link (migration 182)

Invisible to users. Establishes the data PR 3 depends on.

Branch: `feat/groupx-series-link`

### Task 1: Extract the series matcher

`DELETE /group-x/series/:id` already decides "does this ABC class belong to this series" inline at `auth/src/routes/groupX.js:507`. PR 3 needs the same decision. Extract it once, with tests, rather than writing a second copy that can drift.

**Files:**
- Modify: `auth/src/lib/groupXSeries.js`
- Modify: `auth/src/routes/groupX.js` (the target filter inside `DELETE /series/:id`)
- Test: `auth/src/lib/groupXSeries.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `matchesSeries(event, series) -> boolean`
  - `seriesWindow(series) -> { start: string, end: string|null }`
  - `findSeriesForEvent(event, seriesList) -> { series, ambiguous: boolean } | null`

`event` is a shaped ABC class: `{ event_id, event_type_id, employee_id, event_timestamp_local }`.
`series` is a `group_x_series` row.

- [ ] **Step 1: Write the failing tests**

Append to `auth/src/lib/groupXSeries.test.js`:

```js
const { matchesSeries, seriesWindow, findSeriesForEvent } = require('./groupXSeries')

// Aug 4 2026 is a Tuesday.
const series = {
  id: 's1',
  club_number: '7655',
  event_type_id: 'yoga',
  employee_id: 'emp1',
  weekdays: [2],
  start_time: '06:00:00',
  starts_on: '2026-08-01',
  ends_on: '2026-12-31',
  materialized_through: '2026-12-31',
  canceled_at: null,
}
const event = {
  event_id: 'e1',
  event_type_id: 'yoga',
  employee_id: 'emp1',
  event_timestamp_local: '2026-08-04 06:00:00',
}

test('matchesSeries accepts an occurrence on the right weekday, time and range', () => {
  assert.strictEqual(matchesSeries(event, series), true)
})

test('matchesSeries rejects a different class type', () => {
  assert.strictEqual(matchesSeries({ ...event, event_type_id: 'spin' }, series), false)
})

test('matchesSeries rejects a different instructor', () => {
  assert.strictEqual(matchesSeries({ ...event, employee_id: 'emp2' }, series), false)
})

test('matchesSeries rejects a different start time', () => {
  assert.strictEqual(matchesSeries({ ...event, event_timestamp_local: '2026-08-04 07:00:00' }, series), false)
})

test('matchesSeries rejects a date on a weekday the series does not run', () => {
  // Aug 5 2026 is a Wednesday; the series is Tuesdays.
  assert.strictEqual(matchesSeries({ ...event, event_timestamp_local: '2026-08-05 06:00:00' }, series), false)
})

test('matchesSeries rejects a date before the series starts', () => {
  assert.strictEqual(matchesSeries({ ...event, event_timestamp_local: '2026-07-28 06:00:00' }, series), false)
})

test('matchesSeries rejects a date after the series ends', () => {
  assert.strictEqual(matchesSeries({ ...event, event_timestamp_local: '2027-01-05 06:00:00' }, series), false)
})

test('matchesSeries rejects a cancelled series', () => {
  assert.strictEqual(matchesSeries(event, { ...series, canceled_at: '2026-08-02T00:00:00Z' }), false)
})

test('matchesSeries rejects an unparseable timestamp rather than guessing', () => {
  assert.strictEqual(matchesSeries({ ...event, event_timestamp_local: 'nonsense' }, series), false)
})

test('seriesWindow uses materialized_through for an open-ended series', () => {
  // ends_on NULL is the open-ended shape from migration 099. Using ends_on
  // directly here is the bug that orphaned 4 Medford classes on 2026-08-28.
  const open = { ...series, ends_on: null, materialized_through: '2026-11-30' }
  assert.deepStrictEqual(seriesWindow(open), { start: '2026-08-01', end: '2026-11-30' })
})

test('seriesWindow returns a null end when an open series has never been materialised', () => {
  const open = { ...series, ends_on: null, materialized_through: null }
  assert.strictEqual(seriesWindow(open).end, null)
})

test('matchesSeries accepts an occurrence inside an open-ended horizon', () => {
  const open = { ...series, ends_on: null, materialized_through: '2026-11-30' }
  assert.strictEqual(matchesSeries(event, open), true)
})

test('findSeriesForEvent returns the one matching series', () => {
  const r = findSeriesForEvent(event, [series, { ...series, id: 's2', event_type_id: 'spin' }])
  assert.strictEqual(r.series.id, 's1')
  assert.strictEqual(r.ambiguous, false)
})

test('findSeriesForEvent flags an ambiguous match instead of picking one', () => {
  // Two live series of identical shape. Guessing here would rewrite the wrong
  // 40 classes, so the caller must be told it cannot tell them apart.
  const r = findSeriesForEvent(event, [series, { ...series, id: 's2' }])
  assert.strictEqual(r.ambiguous, true)
  assert.strictEqual(r.series, null)
})

test('findSeriesForEvent returns null when nothing matches', () => {
  assert.strictEqual(findSeriesForEvent(event, [{ ...series, event_type_id: 'spin' }]), null)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd auth && npm test`
Expected: FAIL — `matchesSeries is not a function`.

- [ ] **Step 3: Implement the matcher**

Add to `auth/src/lib/groupXSeries.js`, above `module.exports`:

```js
// Which ABC classes belong to a series.
//
// ABC returns no series link on a class, so membership is inferred from shape:
// same class type, same instructor, same wall-clock start, on one of the
// series' weekdays, inside its live date range.
//
// This is the ONLY definition of that judgement. DELETE /series/:id used to
// carry its own copy inline; a second copy is how the two drift apart.

// The end of a series' live range.
//
// An open-ended series has ends_on NULL (migration 099) and records how far it
// has actually been written in materialized_through. Reading ends_on directly
// yields null, and every date comparison against null is false — which is
// exactly how a cancel silently orphaned 4 Medford classes on 2026-08-28.
function seriesWindow(series) {
  return {
    start: series.starts_on,
    end: series.ends_on || series.materialized_through || null,
  }
}

function matchesSeries(event, series) {
  if (!event || !series || series.canceled_at) return false

  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String(event.event_timestamp_local || ''))
  // An unparseable timestamp is unknown, not a match. Never guess membership.
  if (!m) return false
  const date = m[1]
  const wall = `${m[2]}:${m[3]}`

  if (event.event_type_id !== series.event_type_id) return false
  if (event.employee_id !== series.employee_id) return false
  if (wall !== String(series.start_time).slice(0, 5)) return false

  const weekday = new Date(date + 'T00:00:00Z').getUTCDay()
  if (!(series.weekdays || []).includes(weekday)) return false

  const { start, end } = seriesWindow(series)
  if (start && date < start) return false
  if (end && date > end) return false
  return true
}

// A shape can legitimately hit two live series. Returning either one would
// rewrite the wrong classes, so say it is ambiguous and let the caller degrade
// to a single-occurrence edit.
function findSeriesForEvent(event, seriesList) {
  const hits = (seriesList || []).filter(s => matchesSeries(event, s))
  if (hits.length === 0) return null
  if (hits.length > 1) return { series: null, ambiguous: true }
  return { series: hits[0], ambiguous: false }
}
```

Update the export line:

```js
module.exports = { expandSeries, MAX_OCCURRENCES, matchesSeries, seriesWindow, findSeriesForEvent }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd auth && npm test`
Expected: PASS, including the pre-existing `expandSeries` tests.

- [ ] **Step 5: Use the helper in DELETE /series/:id**

In `auth/src/routes/groupX.js`, add `matchesSeries` and `seriesWindow` to the existing `require` of `../lib/groupXSeries`, then replace the inline window and filter (currently around lines 528-545) with:

```js
    const { end: seriesEnd } = seriesWindow(series)
    const windowStart = from > series.starts_on ? from : series.starts_on
    if (!seriesEnd || windowStart > seriesEnd) {
      await supabaseAdmin
        .from('group_x_series')
        .update({ canceled_at: new Date().toISOString(), canceled_by: req.user?.email || 'unknown' })
        .eq('id', series.id)
      return res.json({ canceled: 0, failed: 0, results: [] })
    }

    const existing = await abc.listClasses(series.club_number, windowStart, seriesEnd)
    const targets = existing.filter(e => matchesSeries(e, series))
```

This is behaviour-preserving with one deliberate tightening: the old filter did not check the weekday or the date range, so a class of the right type, instructor and time sitting on a weekday the series does not run was cancelled with it. `matchesSeries` no longer does that.

- [ ] **Step 6: Run the tests**

Run: `cd auth && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add auth/src/lib/groupXSeries.js auth/src/lib/groupXSeries.test.js auth/src/routes/groupX.js
git commit -m "refactor(group-x): one definition of series membership

DELETE /series/:id decided which ABC classes belong to a series inline.
The edit flow needs the same judgement, and a second copy is how the two
drift apart, so it moves to a tested helper.

Tightens the filter while it moves: the inline version checked type,
instructor and time but not the weekday or the date range, so a one-off
class at the same time on a day the series does not run was cancelled
along with it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dp8TbC4jV1NLkxXX8P16X3"
```

### Task 2: Migration 182

**Files:**
- Create: `auth/migrations/182_group_x_series_events.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Which ABC classes a Group X series created.
--
-- Migration 093 deliberately kept no local mirror of the ABC schedule, and
-- that still holds: this table is a LINK, not a copy. It stores no time, no
-- instructor and no class name -- ABC remains the source of truth for all of
-- that. It answers one question the ABC API cannot: which series produced this
-- class.
--
-- Without it, "change every class from here on" has nothing to act on, because
-- POST /series already throws away the event ids it gets back.
--
-- event_date is denormalised from the ABC timestamp purely so the edit path can
-- select "occurrences on or after this date" without calling ABC first.
--
-- This repo has no migration runner. Apply by hand to prod Supabase after merge.

create table if not exists group_x_series_events (
  club_number   text not null,
  abc_event_id  text not null,
  series_id     uuid not null references group_x_series(id) on delete cascade,
  event_date    date not null,
  created_at    timestamptz not null default now(),
  primary key (club_number, abc_event_id)
);

-- The edit path's main read: this series, from this date onward.
create index if not exists group_x_series_events_series_idx
  on group_x_series_events (series_id, event_date);

-- The portal DB is 100% service-role. Every public table gets RLS enabled with
-- no policy, so a leaked anon key reads nothing.
alter table group_x_series_events enable row level security;
```

- [ ] **Step 2: Commit**

```bash
git add auth/migrations/182_group_x_series_events.sql
git commit -m "feat(group-x): migration 182, link classes to their series

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dp8TbC4jV1NLkxXX8P16X3"
```

### Task 3: Record the link where series are created

**Files:**
- Create: `auth/src/lib/groupXSeriesLink.js`
- Modify: `auth/src/routes/groupX.js` (`POST /series`, after the fan-out loop)
- Modify: `auth/src/services/groupXSeriesTopUp.js` (`topUpOne`, after each successful create)
- Test: `auth/src/lib/groupXSeriesLink.test.js`

**Interfaces:**
- Produces: `linkRows(clubNumber, seriesId, results) -> Array<{club_number, abc_event_id, series_id, event_date}>`
  where `results` is `[{ date, ok, event_id }]`. Only `ok` rows with an `event_id` become rows.

- [ ] **Step 1: Write the failing test**

Create `auth/src/lib/groupXSeriesLink.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { linkRows } = require('./groupXSeriesLink')

test('linkRows maps successful creates to link rows', () => {
  assert.deepStrictEqual(
    linkRows('7655', 's1', [{ date: '2026-08-04', ok: true, event_id: 'e1' }]),
    [{ club_number: '7655', abc_event_id: 'e1', series_id: 's1', event_date: '2026-08-04' }],
  )
})

test('linkRows skips failed creates', () => {
  const rows = linkRows('7655', 's1', [
    { date: '2026-08-04', ok: true, event_id: 'e1' },
    { date: '2026-08-11', ok: false, error: 'ABC said no' },
  ])
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].abc_event_id, 'e1')
})

test('linkRows skips a create that succeeded without returning an id', () => {
  // ABC has returned success with no id before. A row keyed on undefined would
  // collide with every other such row on the primary key.
  assert.deepStrictEqual(linkRows('7655', 's1', [{ date: '2026-08-04', ok: true }]), [])
})

test('linkRows coerces the club number to text to match the column', () => {
  assert.strictEqual(linkRows(7655, 's1', [{ date: '2026-08-04', ok: true, event_id: 'e1' }])[0].club_number, '7655')
})

test('linkRows tolerates an empty result list', () => {
  assert.deepStrictEqual(linkRows('7655', 's1', []), [])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd auth && npm test`
Expected: FAIL — cannot find module `./groupXSeriesLink`.

- [ ] **Step 3: Implement**

Create `auth/src/lib/groupXSeriesLink.js`:

```js
// Turning a series fan-out result into link rows for group_x_series_events.
//
// Pure, so the "which creates actually produced a usable id" judgement is
// testable without touching ABC or Supabase.
const { supabaseAdmin } = require('../services/supabase')

function linkRows(clubNumber, seriesId, results) {
  return (results || [])
    // A create can report success without an id. Keying a row on undefined
    // would collide with every other such row on the primary key.
    .filter(r => r && r.ok && r.event_id)
    .map(r => ({
      club_number: String(clubNumber),
      abc_event_id: String(r.event_id),
      series_id: seriesId,
      event_date: r.date,
    }))
}

// Best-effort, exactly like badging: the classes exist in ABC either way, and
// failing the whole request over a missing link would be worse than a missing
// link, which the shape-match fallback covers anyway.
async function recordSeriesEvents(clubNumber, seriesId, results) {
  const rows = linkRows(clubNumber, seriesId, results)
  if (!rows.length) return null
  const { error } = await supabaseAdmin
    .from('group_x_series_events')
    .upsert(rows, { onConflict: 'club_number,abc_event_id' })
  if (error) {
    console.error('[groupX] could not link series events:', error.message)
    return error.message
  }
  return null
}

module.exports = { linkRows, recordSeriesEvents }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd auth && npm test`
Expected: PASS.

- [ ] **Step 5: Call it from POST /series**

In `auth/src/routes/groupX.js`, add near the other requires:

```js
const { recordSeriesEvents } = require('../lib/groupXSeriesLink')
```

In `POST /series`, immediately after `const created = results.filter(r => r.ok).length`:

```js
  // Record which ABC classes this series produced. POST /series has had these
  // ids in hand since it was written and dropped them; "change every class
  // from here on" is what needs them.
  const link_error = await recordSeriesEvents(b.club_number, series.id, results)
```

Add `link_error` to the JSON response object alongside `badge_error`.

- [ ] **Step 6: Call it from the nightly top-up**

In `auth/src/services/groupXSeriesTopUp.js`, add the require, then collect results in `topUpOne`. Change the loop body so successes are captured:

```js
  const results = []
  for (const occ of occurrences) {
    const r = await abc.createClass(series.club_number, { /* unchanged */ })
    results.push({ date: occ.date, ok: r.ok, event_id: r.event_id, error: r.error })
    if (r.ok) {
      created++
      lastDate = occ.date
    } else {
      failed++
      console.error('[groupXTopUp] create failed', series.id, occ.date, r.error)
      break
    }
  }

  // Top-ups create real occurrences of the series, so they link like any other.
  await recordSeriesEvents(series.club_number, series.id, results)
```

- [ ] **Step 7: Run the tests**

Run: `cd auth && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add auth/src/lib/groupXSeriesLink.js auth/src/lib/groupXSeriesLink.test.js auth/src/routes/groupX.js auth/src/services/groupXSeriesTopUp.js
git commit -m "feat(group-x): record which ABC classes a series created

POST /series has had the event id for every class it creates since it was
written, and dropped it on the floor. Store it.

Best-effort like badging: the classes exist in ABC either way, and the
shape-match fallback covers anything unlinked.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dp8TbC4jV1NLkxXX8P16X3"
```

### Task 4: Expose series_id on GET /classes

**Files:**
- Modify: `auth/src/routes/groupX.js` (`GET /classes`)

**Interfaces:**
- Produces: each class in `GET /group-x/classes` gains
  `series_id: string|null` and `series_source: 'linked'|'inferred'|null`.
  An ambiguous shape match yields `series_id: null, series_source: null`.

- [ ] **Step 1: Add the join and the fallback**

In `GET /classes`, after the `markNewClasses` call and before building the response, add:

```js
    // Which classes belong to a repeating series. Two sources, in order of
    // trust: the link table for classes created since migration 182, and a
    // shape match for everything older.
    const [linkRes, seriesRes] = await Promise.all([
      ids.length
        ? supabaseAdmin.from('group_x_series_events')
            .select('abc_event_id, series_id').eq('club_number', club).in('abc_event_id', ids)
        : Promise.resolve({ data: [] }),
      supabaseAdmin.from('group_x_series')
        .select('*').eq('club_number', club).is('canceled_at', null),
    ])
    const linkById = new Map((linkRes.data || []).map(r => [r.abc_event_id, r.series_id]))
    const liveSeries = seriesRes.data || []
```

Then inside the `flagged.map(...)`, add to each returned object:

```js
        const linked = linkById.get(c.event_id) || null
        // Only infer when there is no recorded link. An ambiguous shape --
        // two live series the class could equally belong to -- returns
        // nothing, so the UI degrades to a single-occurrence edit rather than
        // rewriting the wrong series.
        const guess = linked ? null : findSeriesForEvent(c, liveSeries)
```

and in the object literal:

```js
          series_id: linked || guess?.series?.id || null,
          series_source: linked ? 'linked' : (guess?.series ? 'inferred' : null),
```

Add `findSeriesForEvent` to the `require` from `../lib/groupXSeries`.

- [ ] **Step 2: Verify by hand against a real club**

Run the auth API locally against prod Supabase read-only, or hit the deployed preview. Confirm that a week containing a known repeating class returns `series_id` set with `series_source: "linked"` for classes created after migration 182, and `"inferred"` for older ones.

`reference_abc_daterange_needs_span` applies: a `start` equal to `end` returns zero rows. Use a full week.

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/groupX.js
git commit -m "feat(group-x): tell the calendar which classes repeat

Each class now carries series_id plus series_source, so the UI can say
whether the link is recorded or inferred from shape. An ambiguous shape
returns no link rather than guessing which of two series to rewrite.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dp8TbC4jV1NLkxXX8P16X3"
```

### Task 5: Backfill script

**Files:**
- Create: `auth/scripts/backfill-group-x-series-events.js`

- [ ] **Step 1: Write the script**

```js
// One-off backfill for migration 182.
//
// Links classes created before the link table existed, by shape-matching them
// to their series with exactly the same helper the live path uses.
//
// Idempotent: rows upsert on the primary key, so re-running links only what is
// still missing. Safe to run repeatedly, and safe to not run at all -- the
// runtime fallback in GET /classes infers the same links, just without a row.
//
// Usage:  node scripts/backfill-group-x-series-events.js [--apply]
// Without --apply it prints what it would insert and writes nothing.
require('dotenv').config()
const { supabaseAdmin } = require('../src/services/supabase')
const abc = require('../src/services/abcGroupX')
const { matchesSeries, seriesWindow } = require('../src/lib/groupXSeries')

const APPLY = process.argv.includes('--apply')

async function main() {
  const { data: series, error } = await supabaseAdmin
    .from('group_x_series')
    .select('*')
    .is('canceled_at', null)
  if (error) throw new Error(error.message)

  console.log(`${series.length} live series`)
  let total = 0

  for (const s of series) {
    const { start, end } = seriesWindow(s)
    if (!start || !end) {
      console.log(`  ${s.class_name} (${s.id}): no materialised window, skipping`)
      continue
    }
    const classes = await abc.listClasses(s.club_number, start, end)
    const rows = classes
      .filter(c => matchesSeries(c, s))
      .map(c => ({
        club_number: String(s.club_number),
        abc_event_id: String(c.event_id),
        series_id: s.id,
        event_date: String(c.event_timestamp_local).slice(0, 10),
      }))

    console.log(`  ${s.class_name} @ ${s.club_number} (${start}..${end}): ${rows.length} matched`)
    total += rows.length

    if (APPLY && rows.length) {
      const { error: upErr } = await supabaseAdmin
        .from('group_x_series_events')
        .upsert(rows, { onConflict: 'club_number,abc_event_id' })
      if (upErr) console.error(`    FAILED: ${upErr.message}`)
    }
  }

  console.log(APPLY ? `Linked ${total} classes.` : `Would link ${total} classes. Re-run with --apply.`)
}

main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Commit**

```bash
git add auth/scripts/backfill-group-x-series-events.js
git commit -m "chore(group-x): backfill script for the series link

Dry run by default. Idempotent, and optional -- the runtime fallback
infers the same links for anything it does not write.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dp8TbC4jV1NLkxXX8P16X3"
```

### Task 6: Open PR 1

- [ ] **Step 1: Push and open**

```bash
git push -u origin feat/groupx-series-link
gh pr create --title "Group X: link classes to the series that created them" --body "$(cat <<'EOF'
## Why

Migration 093 deliberately kept no local mirror of the ABC schedule, and that
still holds. But it means nothing records which ABC classes a series produced —
`POST /series` has the event id in hand for every class it creates and drops it.
Without that link, "change every class from here on" has nothing to act on.

## What

- **Migration 182** `group_x_series_events` — a link, not a copy. No time, no
  instructor, no class name; ABC stays the source of truth for all of that.
- Series membership moves out of `DELETE /series/:id` into a tested helper, so
  there is one definition of it rather than two that drift. This tightens the
  filter: the inline version checked type, instructor and time but not the
  weekday or date range, so a one-off class at the same time on a day the series
  does not run was cancelled along with it.
- `GET /classes` returns `series_id` and `series_source` (`linked` | `inferred`).
  An ambiguous shape — two live series a class could equally belong to — returns
  no link rather than guessing which one to rewrite.
- Dry-run backfill script for classes predating the table.

Nothing changes on screen. This is groundwork for the edit flow.

## Migration

**182 needs applying by hand to prod Supabase at merge**, then the backfill run
with `--apply`. The backfill is optional — the runtime fallback infers the same
links without it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dp8TbC4jV1NLkxXX8P16X3
EOF
)"
```

---

# PR 2 — Courts & Pool edit

Branch: `feat/facility-edit` (off master, not off PR 1 — no dependency).

### Task 7: Occurrence edit endpoint

**Files:**
- Modify: `auth/src/routes/facilitySchedule.js`

**Interfaces:**
- Produces: `PUT /facility-schedule/events/:id`
  Body: `{ club_number, facility, title, staff_name, date, time, end_time }`
  Returns: `{ ok: true }` or `{ error }`.

- [ ] **Step 1: Implement**

Add after `POST /events`. It reuses that route's validation verbatim — same
`cleanTitle`, same `durationBetween`, same `buildLocalTimestamp`:

```js
// PUT /facility-schedule/events/:id — change one event.
//
// Our own table, so this is an UPDATE. Contrast the Group X side, where ABC has
// no update endpoint and an edit is a create followed by a cancel.
router.put('/events/:id', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number) || !canUseClub(req, b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
  if (!isKnownFacility(b.facility)) {
    return res.status(400).json({ error: 'valid facility is required in body' })
  }
  const title = cleanTitle(b.title)
  if (!title) return res.status(400).json({ error: 'give the event a name' })

  let duration
  let stamp
  try {
    duration = durationBetween(b.time, b.end_time)
    if (!duration || duration <= 0 || duration > 24 * 60) {
      return res.status(400).json({ error: 'give the event an end time after its start time' })
    }
    stamp = buildLocalTimestamp(b.date, b.time)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('facility_events')
      .update({
        title,
        staff_name: b.staff_name ? String(b.staff_name).trim() : null,
        starts_at_local: stamp,
        duration_minutes: duration,
      })
      .eq('id', req.params.id)
      .eq('club_number', String(b.club_number))
      .is('canceled_at', null)
      .select('starts_at_local')
      .single()
    if (error) throw new Error(error.message)

    // Both weeks, or a move across a week boundary leaves the old day cached
    // on the board with the event still on it.
    invalidateBoard(b.club_number, b.facility, [b.date, String(data?.starts_at_local || '').slice(0, 10)])
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'PUT /events') }
})
```

- [ ] **Step 2: Commit**

```bash
git add auth/src/routes/facilitySchedule.js
git commit -m "feat(facility): edit one court or pool event

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dp8TbC4jV1NLkxXX8P16X3"
```

### Task 8: Series-forward edit endpoint

The subtle part: changing the weekday set changes which dates exist, so future
rows are **replaced**, not updated.

**Files:**
- Modify: `auth/src/routes/facilitySchedule.js`

**Interfaces:**
- Produces:
  - `POST /facility-schedule/series/:id/edit-preview` → `{ count, occurrences, replaced }`
  - `PUT /facility-schedule/series/:id/from/:date` → `{ created, removed }`
  Body for both: `{ club_number, facility, title, staff_name, weekdays, start_time, end_time }`.

- [ ] **Step 1: Implement**

```js
// Editing a repeating facility slot from one occurrence onward.
//
// Future rows are REPLACED rather than updated, because changing the weekday
// set changes which dates exist -- a Tuesday series moved to Wednesday has no
// Tuesday row to update. Rows before `date` are never touched.
async function facilitySeriesEdit(req, res, { apply }) {
  const b = req.body || {}
  const from = req.params.date
  if (!DATE_RE.test(from || '')) return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
  if (!isKnownClubNumber(b.club_number) || !canUseClub(req, b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required in body' })
  }
  const title = cleanTitle(b.title)
  if (!title) return res.status(400).json({ error: 'give the event a name' })

  const { data: series, error: selErr } = await supabaseAdmin
    .from('facility_series').select('*').eq('id', req.params.id).single()
  if (selErr || !series) return res.status(404).json({ error: 'series not found' })

  let duration
  try {
    duration = durationBetween(b.start_time, b.end_time)
    if (!duration || duration <= 0) return res.status(400).json({ error: 'give the event an end time after its start time' })
  } catch (err) { return res.status(400).json({ error: err.message }) }

  // Rewrite exactly as far as this series has already been written, no further.
  // The nightly top-up extends an open-ended series from materialized_through
  // using the new definition.
  const through = series.ends_on || series.materialized_through
  if (!through || through < from) return res.status(400).json({ error: 'this series has nothing scheduled from that date onwards' })

  let occurrences
  try {
    occurrences = expandSeries({
      weekdays: b.weekdays, start_time: b.start_time, starts_on: from, ends_on: through,
    })
  } catch (err) { return res.status(400).json({ error: err.message }) }
  if (!occurrences.length) return res.status(400).json({ error: 'those days produce no events. Check the weekday selection.' })

  const { count: replaced } = await supabaseAdmin
    .from('facility_events')
    .select('id', { count: 'exact', head: true })
    .eq('series_id', series.id).is('canceled_at', null).gte('starts_at_local', from)

  if (!apply) return res.json({ count: occurrences.length, occurrences, replaced: replaced || 0 })

  try {
    // Hard delete, not the soft cancel a user-initiated removal uses: these
    // rows are being superseded, not cancelled, and leaving them would show
    // both the old and new times on the board.
    const { error: delErr } = await supabaseAdmin
      .from('facility_events').delete()
      .eq('series_id', series.id).gte('starts_at_local', from)
    if (delErr) throw new Error(delErr.message)

    const rows = occurrences.map(o => ({
      club_number: String(b.club_number),
      facility: String(b.facility),
      title,
      staff_name: b.staff_name ? String(b.staff_name).trim() : null,
      starts_at_local: o.timestamp_local,
      duration_minutes: duration,
      series_id: series.id,
      created_by: req.user?.email || 'unknown',
    }))
    const { error: insErr } = await supabaseAdmin.from('facility_events').insert(rows)
    if (insErr) throw new Error(insErr.message)

    await supabaseAdmin.from('facility_series').update({
      title,
      staff_name: b.staff_name ? String(b.staff_name).trim() : null,
      weekdays: b.weekdays,
      start_time: b.start_time,
      duration_minutes: duration,
    }).eq('id', series.id)

    invalidateBoard(b.club_number, b.facility, occurrences.map(o => o.date))
    res.json({ created: rows.length, removed: replaced || 0 })
  } catch (err) { fail(res, err, 'PUT /series/from') }
}

router.post('/series/:id/edit-preview', requireEdit, (req, res) => facilitySeriesEdit(req, res, { apply: false }))
router.put('/series/:id/from/:date', requireEdit, (req, res) => facilitySeriesEdit(req, res, { apply: true }))
```

- [ ] **Step 2: Commit**

```bash
git add auth/src/routes/facilitySchedule.js
git commit -m "feat(facility): edit a repeating slot from one date onward

Future rows are replaced, not updated: moving a series from Tuesday to
Wednesday leaves no Tuesday row to update. Anything before the edit date
is untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dp8TbC4jV1NLkxXX8P16X3"
```

### Task 9: The shared edit modal shell

Built in `facility/` first, then reused by PR 3. It owns the scope toggle, the
preview/confirm step and the footer actions; each scheduler passes its own
fields.

**Files:**
- Create: `portal/src/components/schedule/EditScopeToggle.jsx`
- Create: `portal/src/components/facility/EditEventModal.jsx`

**Interfaces:**
- Produces: `<EditScopeToggle scope onChange hasSeries seriesSource />`
  `scope` is `'one' | 'forward'`.

- [ ] **Step 1: Write the scope toggle**

```jsx
// This one / all from here on. Only offered when the occurrence belongs to a
// series -- a one-off has nothing to apply forward to.
//
// An INFERRED series link is stated rather than hidden: it was matched by
// shape, not recorded, so the staff member should know what the change is about
// to touch before it rewrites months of calendar.
export default function EditScopeToggle({ scope, onChange, hasSeries, seriesSource }) {
  if (!hasSeries) return null
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex gap-1.5">
        {[
          { v: 'one', label: 'This class' },
          { v: 'forward', label: 'All from here on' },
        ].map(o => (
          <button key={o.v} type="button" onClick={() => onChange(o.v)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition ${
              scope === o.v
                ? 'bg-wcs-red text-white border-wcs-red font-medium'
                : 'border-border text-text-primary hover:bg-bg'
            }`}>
            {o.label}
          </button>
        ))}
      </div>
      {scope === 'forward' && seriesSource === 'inferred' && (
        <p className="text-xs text-amber-800">
          This class was matched to a repeating series by its day, time and instructor
          rather than a recorded link. Check the preview lists the classes you expect.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build EditEventModal**

Copy `facility/CreateEventModal.jsx` as the starting point — same fields, same
weekday pills, same preview/confirm step — and change:

- props become `{ club, facility, event, onClose, onSaved }`
- state seeds from `event` rather than blank
- `<EditScopeToggle>` at the top, replacing the `Recurring` checkbox
- the weekday pills show only when `scope === 'forward'`; the date input shows
  only when `scope === 'one'`
- submit calls `PUT /facility-schedule/events/:id` for `one`; for `forward` it
  calls `POST /series/:id/edit-preview`, shows the dates, then
  `PUT /series/:id/from/:date`
- footer gains **Cancel this event** and, when `event.series_id`,
  **Cancel this and all after** wired to the existing
  `DELETE /facility-schedule/series/:id?through=<day before this occurrence>`

- [ ] **Step 3: Wire it into FacilityView**

In `portal/src/components/facility/FacilityView.jsx`, replace the read-only
`selected` popover with `EditEventModal` when the event is today or later:

```jsx
const isPast = String(selected.event_timestamp_local).slice(0, 10) < toISODate(new Date())
```

Past events keep today's read-only popover. Delete the inline `endSeries` block
and its `endThrough` state — that behaviour now lives in the modal.

- [ ] **Step 4: Verify in the app**

Run the portal against the auth API. Confirm: editing a one-off changes it;
editing a series occurrence "this one" leaves siblings alone; "all from here on"
previews the right dates and moves only future ones; a past event is read-only.

- [ ] **Step 5: Commit and open PR 2**

```bash
git add portal/src/components/schedule/EditScopeToggle.jsx portal/src/components/facility/
git commit -m "feat(facility): edit a court or pool event from the calendar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dp8TbC4jV1NLkxXX8P16X3"
git push -u origin feat/facility-edit
gh pr create --title "Courts & Pool: edit an event instead of deleting and retyping it" --body "..."
```

---

# PR 3 — Group X edit

Branch: `feat/groupx-edit`, off PR 1's branch (needs `series_id` on `GET /classes`).

### Task 10: Occurrence edit endpoint

**Files:**
- Modify: `auth/src/routes/groupX.js`

**Interfaces:**
- Produces: `PUT /group-x/classes/:eventId`
  Body: `{ club_number, event_type_id, employee_id, date, time, training_level_id, class_name, old_date }`
  Returns: `{ event_id, badge_error, link_error }`.

  `old_date` is the date the class was on *before* the edit. The client always
  sends it. It exists so the board cache can be cleared for both weeks when an
  edit moves a class across a week boundary — without it, the old week keeps
  serving the class at its old time for up to 5 minutes.

- [ ] **Step 1: Implement**

```js
// PUT /group-x/classes/:eventId — change one class.
//
// ABC has no event-update endpoint (PUT /events/{id} is a 405 for every body
// shape), so this is a create followed by a cancel, and the event id changes.
//
// CREATE RUNS FIRST, deliberately. If the create fails we still have the
// original class; if the cancel fails we have a duplicate, which is visible and
// fixable. The reverse order risks deleting a class and failing to recreate it,
// leaving a hole nobody notices until members turn up.
router.put('/classes/:eventId', requireEdit, async (req, res) => {
  const b = req.body || {}
  if (!requireBodyClub(req, res, b.club_number)) return
  if (!b.event_type_id || !b.employee_id) {
    return res.status(400).json({ error: 'event_type_id and employee_id are required' })
  }

  // Past classes are not editable. A past class is never deleted, so a logged
  // headcount can never be lost to a rebuild.
  if (b.date < toIsoDate(new Date())) {
    return res.status(400).json({ error: 'that class has already happened and cannot be changed' })
  }

  let stamp
  try {
    stamp = buildLocalTimestamp(b.date, b.time)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  const oldId = req.params.eventId
  try {
    const created = await abc.createClass(String(b.club_number), {
      event_type_id: b.event_type_id,
      employee_id: b.employee_id,
      event_timestamp_local: stamp,
      training_level_id: b.training_level_id || null,
    })
    if (!created.ok) return res.status(502).json({ error: created.error, abc_status: created.http })

    const canceled = await abc.cancelClass(String(b.club_number), oldId)
    if (!canceled.ok) {
      // The new class exists. Say so plainly rather than reporting a failure
      // that would have staff create it a second time.
      return res.status(502).json({
        error: `The new class was created, but the old one could not be removed: ${canceled.error}. Cancel it by hand on the calendar.`,
        event_id: created.event_id,
        abc_status: canceled.http,
      })
    }

    // Carry what was keyed to the old id across to the new one. Best-effort,
    // like badging on create: the class exists either way.
    const moved = await moveClassRefs(b.club_number, oldId, created.event_id, b.date, b.class_name)

    invalidatePublicBoard(b.club_number, [b.date, b.old_date || b.date])
    res.json({ event_id: created.event_id, ...moved })
  } catch (err) { fail(res, err, 'PUT /classes') }
})
```

- [ ] **Step 2: Write moveClassRefs with tests**

**Files:** create `auth/src/lib/groupXClassRefs.js` and its `.test.js`.

Pure part first — which tables need repointing:

```js
// Everything in our own DB keyed on an ABC event id. When an edit replaces a
// class the id changes, so each of these has to follow it or it is orphaned.
//
// Attendance is included for completeness even though editing is restricted to
// future classes, which have no headcount: if a row somehow exists, losing it
// silently would be the worst outcome here.
const REF_TABLES = [
  { table: 'group_x_new_class_events', column: 'abc_event_id' },
  { table: 'group_x_series_events', column: 'abc_event_id' },
  { table: 'group_x_class_attendance', column: 'abc_event_id' },
]
```

Test that `REF_TABLES` covers every table with an `abc_event_id` column by
grepping the migrations — a new table added later without updating this list is
exactly how an orphan appears.

- [ ] **Step 3: Run tests, commit**

Run: `cd auth && npm test` → PASS.

### Task 11: Series-forward edit endpoints

**Files:**
- Modify: `auth/src/routes/groupX.js`

**Interfaces:**
- Produces:
  - `POST /group-x/series/:id/edit-preview` → `{ count, occurrences, replacing }`
  - `PUT /group-x/series/:id/from/:date` → `{ created, failed, occurrences, link_error }`

- [ ] **Step 1: Implement**

Same two-step shape as `POST /series/preview` + `POST /series`. Targets are
found by `group_x_series_events` where `event_date >= from`, falling back to
`abc.listClasses` + `matchesSeries` for unlinked classes. Then, sequentially:
create each new occurrence, and only once all creates are done, cancel the old
targets. Report `created` / `failed` with ABC's per-date error, exactly as
`POST /series` does.

- [ ] **Step 2: Commit**

### Task 12: The Group X edit modal, and removing SeriesList

**Files:**
- Create: `portal/src/components/groupx/EditClassModal.jsx`
- Modify: `portal/src/components/groupx/GroupXView.jsx`
- Delete: `portal/src/components/groupx/SeriesList.jsx`

- [ ] **Step 1: Build EditClassModal**

Mirror `facility/EditEventModal.jsx`, with the Group X field set: class,
instructor, training level, date/weekdays, time, **read-only Length**, New
badge. Reuse `EditScopeToggle`.

- [ ] **Step 2: Wire into GroupXView, remove SeriesList**

Replace the read-only `selected` popover with `EditClassModal` for today-and-
later classes. Delete the `Repeating` toolbar button, the `seriesListOpen`
state, the `SeriesList` import and the file.

- [ ] **Step 3: Verify against a real club, then commit and open PR 3**

Confirm on one club: edit a one-off; edit one occurrence of a series; edit a
series forward and check the preview; end a series from the modal; confirm a
past class stays read-only; confirm the TV board updates within 5 minutes.

---

# PR 4 — Monday-anchored grids

Branch: `feat/monday-grids`, off master. Independent of 1-3.

### Task 13: Label day headers from their own date

**Files:**
- Modify: `portal/src/components/groupx/WeekGrid.jsx`
- Modify: `portal/src/lib/weekGrid.js`
- Test: `portal/src/lib/weekGrid.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('startOfWeekMonday anchors to Monday from any day', () => {
  // Sep 2 2026 is a Wednesday; Aug 31 is the Monday.
  assert.strictEqual(toISODate(startOfWeekMonday(new Date('2026-09-02T12:00:00'))), '2026-08-31')
})

test('startOfWeekMonday on a Sunday goes back six days, not forward one', () => {
  // Sep 6 2026 is a Sunday. Sunday belongs to the week that began Aug 31.
  assert.strictEqual(toISODate(startOfWeekMonday(new Date('2026-09-06T12:00:00'))), '2026-08-31')
})

test('startOfWeekMonday on a Monday is that Monday', () => {
  assert.strictEqual(toISODate(startOfWeekMonday(new Date('2026-08-31T12:00:00'))), '2026-08-31')
})

test('startOfWeek is untouched and still anchors to Sunday', () => {
  // PT Scheduler depends on this. It must not move.
  assert.strictEqual(toISODate(startOfWeek(new Date('2026-09-02T12:00:00'))), '2026-08-30')
})
```

- [ ] **Step 2: Implement**

```js
// Monday-anchored week, for the Group X and Courts & Pool calendars. They match
// the printed sheet and the public TV board, both of which are Monday-first.
//
// Separate from startOfWeek rather than a flag on it: PT Scheduler is in
// production on the Sunday-anchored version and must not move as a side effect.
export function startOfWeekMonday(d) {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  // getDay() is 0 for Sunday, which belongs to the week that began six days
  // earlier, not the one starting tomorrow.
  const back = (out.getDay() + 6) % 7
  out.setDate(out.getDate() - back)
  return out
}
```

- [ ] **Step 3: Fix the day headers**

In `WeekGrid.jsx`, `WEEKDAY_LABELS[i]` indexes by column position, which
hard-wires a Sunday start. Label from the date instead:

```jsx
{WEEKDAY_LABELS[d.getDay()]}
```

- [ ] **Step 4: Anchor both views to Monday**

In `GroupXView.jsx` and `FacilityView.jsx`, swap `startOfWeek` for
`startOfWeekMonday` in the initial state and the "This week" / "Today" handlers.
Leave `PtSchedulerView` alone.

- [ ] **Step 5: Verify, commit, open PR 4**

Confirm both grids start on Monday, the day numbers line up with the labels,
"Today" lands on the right week, and PT Scheduler still starts on Sunday.

---

## Self-review notes

- **Spec coverage:** series link (T1-T5), edit modal (T9, T12), facility save
  (T7, T8), Group X save (T10, T11), Monday grids (T13), `SeriesList` removal
  (T12). All spec sections have a task.
- **Type consistency:** `matchesSeries(event, series)`, `seriesWindow(series)`,
  `findSeriesForEvent(event, list)`, `linkRows(club, seriesId, results)`,
  `recordSeriesEvents(...)` are used with the same names and argument order in
  every task that consumes them.
- **Known thin spots:** Tasks 11 and 12 are specified at a lower resolution than
  1-10 because they build directly on patterns those tasks establish
  (`POST /series` for the fan-out, `EditEventModal` for the UI). Expand them
  from the finished code at execution time rather than guessing now.
