# PT Sessions Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop "PT Sessions" tile to Reporting that pivots ABC calendar appointments by trainer × event type with drill-down to individual sessions, backfilled from 2026-01-01.

**Architecture:** New `abc_calendar_events` Supabase table populated by ghl-sync (delta + backfill from ABC `/calendars/events`, filtered to `category=Appointment` and `status IN (Completed, Canceled-Charge)`). Auth API exposes `/reports/pt-sessions` (pivot summary) and `/reports/pt-sessions/trainer/:employee_id` (drill-down). Portal renders both via `PTSessionsReport.jsx`.

**Tech Stack:** Node/Express (auth, ghl-sync), React 19 + Vite + Tailwind 4 (portal), Postgres (Supabase). Spec at `docs/superpowers/specs/2026-05-07-pt-sessions-design.md`.

**Testing note:** This codebase has no unit-test framework. Verification at each step uses Supabase SQL queries, ghl-sync log inspection, and curl smoke tests against deployed endpoints. No new test infra is added by this plan — that's a separate effort.

**Branch:** All work on `feat/pt-sessions-report`. Single PR at the end.

---

### Task 1: Migration

**Files:**
- Create: `ghl-sync/migrations/005_abc_calendar_events.sql`

- [ ] **Step 1: Create migration file**

Create `ghl-sync/migrations/005_abc_calendar_events.sql`:

```sql
-- Migration: PT/Appointment calendar events from ABC /calendars/events
-- Filtered at sync time to category='Appointment' AND status in
-- ('Completed','Canceled-Charge'). Multi-member events (Classes) are out of scope.

CREATE TABLE IF NOT EXISTS abc_calendar_events (
  club_number               TEXT NOT NULL,
  event_id                  TEXT NOT NULL,
  event_type_id             TEXT,
  event_name                TEXT,
  category                  TEXT,
  event_timestamp           TIMESTAMPTZ,
  event_timestamp_local     TIMESTAMP,
  status                    TEXT,
  duration_minutes          INTEGER,
  employee_id               TEXT,
  employee_first_name       TEXT,
  employee_last_name        TEXT,
  location_id               TEXT,
  location_name             TEXT,
  training_level            TEXT,
  earnings_code             TEXT,
  member_id                 TEXT,
  member_first_name         TEXT,
  member_last_name          TEXT,
  attended_status           TEXT,
  modified_timestamp_abc    TIMESTAMPTZ,
  fetched_at                TIMESTAMPTZ DEFAULT now(),
  raw                       JSONB,
  PRIMARY KEY (club_number, event_id)
);

CREATE INDEX IF NOT EXISTS abc_cal_events_club_time
  ON abc_calendar_events (club_number, event_timestamp);
CREATE INDEX IF NOT EXISTS abc_cal_events_employee_time
  ON abc_calendar_events (employee_id, event_timestamp);
CREATE INDEX IF NOT EXISTS abc_cal_events_event_type
  ON abc_calendar_events (event_type_id);
```

- [ ] **Step 2: Apply migration to Supabase**

Run via the Supabase MCP `apply_migration` tool with name `abc_calendar_events` and the SQL above. Project ID: `ybopxxydsuwlbwxiuzve`.

- [ ] **Step 3: Verify table exists**

Run via Supabase MCP `execute_sql`:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'abc_calendar_events' ORDER BY ordinal_position;
```
Expected: 24 columns matching the migration.

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/pt-sessions-report
git add ghl-sync/migrations/005_abc_calendar_events.sql
git commit -m "feat(ghl-sync): migration for abc_calendar_events table"
```

---

### Task 2: ABC calendar events module

**Files:**
- Create: `ghl-sync/src/abc/calendarEvents.js`

- [ ] **Step 1: Create the module**

Create `ghl-sync/src/abc/calendarEvents.js`:

```js
const axios = require('axios');
const supabase = require('../db/supabase');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

const STATUSES_DEFAULT = ['completed', 'canceled-charge'];
const PAGE_SIZE = 200;

function fmtDate(d) {
  // ABC accepts "YYYY-MM-DD" for eventDateRange.
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function parseAbcTimestamp(s) {
  // ABC returns "YYYY-MM-DD HH:mm:ss[.SSSSSS]" with no timezone.
  // All WCS clubs are in America/Los_Angeles, so interpret accordingly.
  if (!s) return { utc: null, local: null };
  const cleaned = s.replace('T', ' ').replace(/\.\d+$/, '');
  // Local (no TZ): the raw value
  const local = cleaned;
  // UTC: parse as Pacific time. Postgres handles the conversion if we pass
  // the raw string with explicit "America/Los_Angeles" via SQL — but here we
  // approximate by using new Date() which Node parses as local time of the
  // running process. To stay deterministic, build an ISO string with -07:00
  // (PDT) when the date is in DST, else -08:00 (PST). Approximation good
  // enough for reports; switch to a TZ lib if precision matters more.
  const d = new Date(cleaned + 'Z'); // first parse as UTC for date math
  const isDst = isDstPacific(d);
  const offset = isDst ? '-07:00' : '-08:00';
  const utc = new Date(cleaned.replace(' ', 'T') + offset).toISOString();
  return { utc, local };
}

function isDstPacific(d) {
  // US DST: 2nd Sun of March 02:00 -> 1st Sun of November 02:00.
  const y = d.getUTCFullYear();
  const dst = (yy) => {
    const mar = new Date(Date.UTC(yy, 2, 1));
    mar.setUTCDate(mar.getUTCDate() + ((7 - mar.getUTCDay()) % 7) + 7);
    const nov = new Date(Date.UTC(yy, 10, 1));
    nov.setUTCDate(nov.getUTCDate() + ((7 - nov.getUTCDay()) % 7));
    return { start: mar, end: nov };
  };
  const { start, end } = dst(y);
  return d >= start && d < end;
}

function transformEvent(evt, clubNumber) {
  const ts = parseAbcTimestamp(evt.eventTimestamp);
  const member = (evt.members && evt.members[0]) || {};
  return {
    club_number: clubNumber,
    event_id: evt.eventId,
    event_type_id: evt.eventTypeId || null,
    event_name: evt.eventName || null,
    category: evt.category || null,
    event_timestamp: ts.utc,
    event_timestamp_local: ts.local,
    status: evt.status || null,
    duration_minutes: evt.duration ? parseInt(evt.duration, 10) : null,
    employee_id: evt.employeeId || null,
    employee_first_name: evt.employeeFirstName || null,
    employee_last_name: evt.employeeLastName || null,
    location_id: evt.locationId || null,
    location_name: evt.locationName || null,
    training_level: evt.eventTrainingLevel?.levelName || null,
    earnings_code: evt.earningsCode || null,
    member_id: member.memberId || null,
    member_first_name: member.firstName || null,
    member_last_name: member.lastName || null,
    attended_status: member.attendedStatus || null,
    modified_timestamp_abc: parseAbcTimestamp(evt.modifiedTimestamp).utc,
    fetched_at: new Date().toISOString(),
    raw: evt,
  };
}

async function fetchCalendarEvents(clubNumber, fromDate, toDate, status, page = 1) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }
  const url = `${ABC_BASE_URL}/${clubNumber}/calendars/events`;
  const eventDateRange = `${fmtDate(fromDate)},${fmtDate(toDate)}`;
  const res = await axios.get(url, {
    params: { eventDateRange, eventStatus: status, size: PAGE_SIZE, page },
    headers: {
      app_id: ABC_APP_ID,
      app_key: ABC_APP_KEY,
      Accept: 'application/json',
    },
    timeout: 60000,
  });
  const events = res.data?.events || [];
  const nextPage = res.data?.status?.nextPage || null;
  return { events, nextPage };
}

async function syncCalendarEventsForClub(clubNumber, fromDate, toDate, statuses = STATUSES_DEFAULT, sleepMs = 0) {
  let totalUpserted = 0;
  for (const status of statuses) {
    let page = 1;
    while (true) {
      const { events, nextPage } = await fetchCalendarEvents(clubNumber, fromDate, toDate, status, page);
      const appointments = events.filter((e) => e.category === 'Appointment');
      if (appointments.length > 0) {
        const rows = appointments.map((e) => transformEvent(e, clubNumber));
        const { error } = await supabase
          .from('abc_calendar_events')
          .upsert(rows, { onConflict: 'club_number,event_id' });
        if (error) {
          console.error(`[CalEvents] ${clubNumber} ${status} p${page} upsert error: ${error.message}`);
        } else {
          totalUpserted += rows.length;
        }
      }
      console.log(`[CalEvents] ${clubNumber} ${status} p${page}: ${events.length} fetched, ${appointments.length} appointments upserted (next=${nextPage || 'none'})`);
      if (!nextPage) break;
      page = parseInt(nextPage, 10);
      if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
    }
  }
  return totalUpserted;
}

module.exports = {
  fetchCalendarEvents,
  syncCalendarEventsForClub,
  transformEvent,
  parseAbcTimestamp,
};
```

- [ ] **Step 2: Smoke test the module locally (skipped — no local ABC creds)**

Skip; will exercise after deploy in Task 10.

- [ ] **Step 3: Commit**

```bash
git add ghl-sync/src/abc/calendarEvents.js
git commit -m "feat(ghl-sync): ABC calendar events fetch + sync module"
```

---

### Task 3: Backfill CLI

**Files:**
- Create: `ghl-sync/scripts/backfill-calendar-events.js`

- [ ] **Step 1: Create the script**

Create `ghl-sync/scripts/backfill-calendar-events.js`:

```js
#!/usr/bin/env node
/**
 * Backfill abc_calendar_events from ABC for a date range and clubs.
 *
 * Usage:
 *   node scripts/backfill-calendar-events.js --from 2026-01-01 --to 2026-05-07
 *   node scripts/backfill-calendar-events.js --from 2026-01-01 --to 2026-05-07 --clubs 30935,31599
 *   node scripts/backfill-calendar-events.js --days 30
 */
require('dotenv').config();
const LOCATIONS = require('../src/config/locations');
const { syncCalendarEventsForClub } = require('../src/abc/calendarEvents');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

function parseDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z');
  const d = new Date(s);
  if (isNaN(d)) throw new Error(`Bad date: ${s}`);
  return d;
}

(async () => {
  const days = arg('days');
  const fromArg = arg('from');
  const toArg = arg('to');
  const clubsArg = arg('clubs');
  const sleepMs = parseInt(arg('sleep', '100'), 10);

  let from, to;
  if (days) {
    to = new Date();
    from = new Date(Date.now() - parseInt(days, 10) * 86400000);
  } else {
    if (!fromArg || !toArg) {
      console.error('Need --from <date> and --to <date>, or --days <N>.');
      process.exit(1);
    }
    from = parseDate(fromArg);
    to = parseDate(toArg);
  }

  const clubFilter = clubsArg ? new Set(clubsArg.split(',').map((s) => s.trim())) : null;
  const clubs = LOCATIONS
    .map((l) => l.clubNumber)
    .filter(Boolean)
    .filter((c) => !clubFilter || clubFilter.has(c));

  console.log(`Backfilling calendar events for ${clubs.length} club(s) from ${from.toISOString().slice(0,10)} to ${to.toISOString().slice(0,10)}`);

  for (const club of clubs) {
    console.log(`\n=== Club ${club} ===`);
    const upserted = await syncCalendarEventsForClub(club, from, to, ['completed', 'canceled-charge'], sleepMs);
    console.log(`Club ${club} done: ${upserted} appointments upserted.`);
  }

  console.log('\nAll done.');
})().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/scripts/backfill-calendar-events.js
git commit -m "feat(ghl-sync): backfill CLI for abc_calendar_events"
```

---

### Task 4: Parallel backfill helper

**Files:**
- Create: `ghl-sync/scripts/backfill-cal-fast.sh`

- [ ] **Step 1: Create the helper**

Create `ghl-sync/scripts/backfill-cal-fast.sh`:

```bash
#!/bin/bash
# Restart parallel calendar-events backfill — one process per club.
# Logs in /tmp/bk-cal-<club>.log. Idempotent: safe to re-run.
# Usage: bash ghl-sync/scripts/backfill-cal-fast.sh [from] [to]
set -u
cd "$(dirname "$0")/.."

FROM="${1:-2026-01-01}"
TO="${2:-$(date -u +%Y-%m-%d)}"

echo "Killing any existing backfill-calendar-events processes..."
pkill -f backfill-calendar-events || true
sleep 3

CLUBS=(30935 31599 7655 31598 31600 31601 32073)
for c in "${CLUBS[@]}"; do
  nohup node scripts/backfill-calendar-events.js \
    --from "$FROM" --to "$TO" --clubs "$c" --sleep 100 \
    > "/tmp/bk-cal-$c.log" 2>&1 &
  echo "Club $c -> PID $!"
done

sleep 5
echo
echo "--- PIDS ---"
pgrep -fa backfill-calendar-events
echo
echo "--- TAILS ---"
for c in "${CLUBS[@]}"; do
  echo "=== $c ==="
  tail -n 3 "/tmp/bk-cal-$c.log" 2>/dev/null || echo "(no log yet)"
done
```

- [ ] **Step 2: Commit**

```bash
git add ghl-sync/scripts/backfill-cal-fast.sh
git commit -m "feat(ghl-sync): parallel-per-club calendar-events backfill helper"
```

---

### Task 5: Delta sync hook

**Files:**
- Modify: `ghl-sync/src/sync/deltaSync.js`

- [ ] **Step 1: Read the current deltaSync.js to find the loop end**

Open `ghl-sync/src/sync/deltaSync.js`. Locate the closing `}` of the `for (const location of LOCATIONS)` loop (the loop that does contacts + opportunities deltas). Identify the line just before the loop closes.

- [ ] **Step 2: Add import**

At the top of the file alongside the `refreshCurrentHourCheckins` require, add:

```js
const { syncCalendarEventsForClub } = require('../abc/calendarEvents');
```

- [ ] **Step 3: Add the sync call inside the location loop**

Just before the closing `}` of `for (const location of LOCATIONS)`, after the opportunities try/catch, add:

```js
    // Calendar events delta — last 7 days through end-of-tomorrow.
    // Catches newly-completed sessions and Pending->Completed/Canceled-Charge flips.
    if (location.clubNumber) {
      const calStart = new Date().toISOString();
      try {
        const now = new Date();
        const calFrom = new Date(now.getTime() - 7 * 86400000);
        const calTo = new Date(now.getTime() + 86400000);
        const upserted = await syncCalendarEventsForClub(location.clubNumber, calFrom, calTo);
        if (upserted > 0) {
          console.log(`[Delta] ${location.name}: ${upserted} calendar events upserted`);
        }
        await writeSyncLog({ syncType: 'delta', entity: 'calendar_events', locationId: location.id, recordsFetched: upserted, recordsUpserted: upserted, errors: [], startedAt: calStart });
        anySuccess = true;
      } catch (err) {
        console.error(`[Delta] ${location.name} calendar events failed:`, err.message);
        await writeSyncLog({ syncType: 'delta', entity: 'calendar_events', locationId: location.id, recordsFetched: 0, recordsUpserted: 0, errors: [{ error: err.message }], startedAt: calStart });
      }
    }
```

- [ ] **Step 4: Commit**

```bash
git add ghl-sync/src/sync/deltaSync.js
git commit -m "feat(ghl-sync): hook calendar events sync into delta loop"
```

---

### Task 6: Auth API endpoints

**Files:**
- Create: `auth/src/routes/ptSessions.js`
- Modify: `auth/src/index.js`
- Modify: `auth/src/middleware/role.js`

- [ ] **Step 1: Create the route file**

Create `auth/src/routes/ptSessions.js`:

```js
const { Router } = require('express')
const supabaseAdmin = require('../db/supabaseAdmin')
const { requireAuth } = require('../middleware/auth')
const { requireRole, canSeeAllLocations, canAccessReport } = require('../middleware/role')
const { getStaffLocations, resolveSlugToClub } = require('../services/staffLocations')

const router = Router()

const DEFAULT_STATUSES = ['Completed', 'Canceled-Charge']

router.use(requireAuth, requireRole('lead'))

// Resolves the set of clubNumbers a query is allowed to scan, given the
// staff member's role and the requested location_slug. Throws on auth fail.
async function resolveClubsForRequest(req) {
  const { staff } = req
  const slug = (req.query.location_slug || '').trim()
  if (!slug) {
    const err = new Error('location_slug is required')
    err.status = 400
    throw err
  }
  if (!canAccessReport(staff.role, 'pt-sessions')) {
    const err = new Error('Insufficient role for pt-sessions report')
    err.status = 403
    throw err
  }

  const allowedClubs = await getStaffLocations(staff.id) // returns array of clubNumbers
  if (slug === 'all') {
    if (!canSeeAllLocations(staff.role)) {
      const err = new Error("'all' is not allowed for your role")
      err.status = 403
      throw err
    }
    return null // null = no club filter
  }
  const club = await resolveSlugToClub(slug)
  if (!club) {
    const err = new Error(`Unknown location_slug: ${slug}`)
    err.status = 400
    throw err
  }
  if (!canSeeAllLocations(staff.role) && !allowedClubs.includes(club)) {
    const err = new Error(`location_slug '${slug}' is not in your assigned locations`)
    err.status = 403
    throw err
  }
  return [club]
}

function parseStatuses(raw) {
  if (!raw) return DEFAULT_STATUSES
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// GET /reports/pt-sessions
router.get('/', async (req, res) => {
  try {
    const clubs = await resolveClubsForRequest(req)
    const { from, to } = req.query
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' })
    const statuses = parseStatuses(req.query.status)

    let q = supabaseAdmin
      .from('abc_calendar_events')
      .select('employee_id, employee_first_name, employee_last_name, event_name, status')
      .gte('event_timestamp', new Date(from + 'T00:00:00-07:00').toISOString())
      .lt('event_timestamp', new Date(new Date(to + 'T00:00:00-07:00').getTime() + 86400000).toISOString())
      .in('status', statuses)
    if (clubs) q = q.in('club_number', clubs)

    const { data, error } = await q.limit(50000)
    if (error) return res.status(500).json({ error: error.message })

    // Pivot in JS: trainers -> by_event_type
    const trainers = new Map()
    let totalCompleted = 0
    let totalCanceled = 0
    const eventTypeTotals = new Map()

    for (const row of (data || [])) {
      const tid = row.employee_id || 'unassigned'
      const tname = `${row.employee_first_name || ''} ${row.employee_last_name || ''}`.trim() || 'Unbooked'
      const ev = row.event_name || 'Unknown'
      const st = row.status

      let t = trainers.get(tid)
      if (!t) {
        t = { employee_id: tid, employee_name: tname, total: 0, completed: 0, canceled_charge: 0, by_event_type: {} }
        trainers.set(tid, t)
      }
      t.total += 1
      if (st === 'Completed') { t.completed += 1; totalCompleted += 1 }
      else if (st === 'Canceled-Charge') { t.canceled_charge += 1; totalCanceled += 1 }

      const cell = t.by_event_type[ev] || { completed: 0, canceled_charge: 0 }
      if (st === 'Completed') cell.completed += 1
      else if (st === 'Canceled-Charge') cell.canceled_charge += 1
      t.by_event_type[ev] = cell

      eventTypeTotals.set(ev, (eventTypeTotals.get(ev) || 0) + 1)
    }

    const trainersArr = [...trainers.values()].sort((a, b) => b.total - a.total)
    const eventTypes = [...eventTypeTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)

    const total = totalCompleted + totalCanceled
    res.json({
      summary: {
        total_sessions: total,
        completed: totalCompleted,
        canceled_charge: totalCanceled,
        attendance_rate: total > 0 ? totalCompleted / total : 0,
      },
      trainers: trainersArr,
      event_types: eventTypes,
    })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /reports/pt-sessions/trainer/:employee_id
router.get('/trainer/:employee_id', async (req, res) => {
  try {
    const clubs = await resolveClubsForRequest(req)
    const { from, to } = req.query
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' })
    const statuses = parseStatuses(req.query.status)

    let q = supabaseAdmin
      .from('abc_calendar_events')
      .select('event_id, event_timestamp, event_timestamp_local, event_name, status, duration_minutes, member_id, member_first_name, member_last_name, attended_status, location_name')
      .eq('employee_id', req.params.employee_id)
      .gte('event_timestamp', new Date(from + 'T00:00:00-07:00').toISOString())
      .lt('event_timestamp', new Date(new Date(to + 'T00:00:00-07:00').getTime() + 86400000).toISOString())
      .in('status', statuses)
      .order('event_timestamp', { ascending: false })
      .limit(2000)
    if (clubs) q = q.in('club_number', clubs)

    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })

    const sessions = (data || []).map((r) => ({
      event_id: r.event_id,
      event_timestamp: r.event_timestamp,
      event_timestamp_local: r.event_timestamp_local,
      event_name: r.event_name,
      status: r.status,
      duration_minutes: r.duration_minutes,
      member_id: r.member_id,
      member_name: `${r.member_first_name || ''} ${r.member_last_name || ''}`.trim() || null,
      attended_status: r.attended_status,
      location_name: r.location_name,
    }))
    res.json({ sessions })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

module.exports = router
```

- [ ] **Step 2: Add to REPORT_ACCESS in middleware/role.js**

In `auth/src/middleware/role.js`, find the `REPORT_ACCESS` object and add `'pt-sessions'`:

```js
const REPORT_ACCESS = {
  membership:    ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  'club-health': ['manager', 'marketing', 'corporate', 'admin'],
  pt:            ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  checkins:      ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  'pt-sessions': ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  marketing:     ['marketing', 'corporate', 'admin'],
}
```

- [ ] **Step 3: Mount the route in index.js**

In `auth/src/index.js`, after the existing `/reports/checkins` line (around line 48), add:

```js
app.use('/reports/pt-sessions', require('./routes/ptSessions'))
```

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/ptSessions.js auth/src/middleware/role.js auth/src/index.js
git commit -m "feat(auth): /reports/pt-sessions pivot + trainer drill-down endpoints"
```

---

### Task 7: Portal API client

**Files:**
- Modify: `portal/src/lib/api.js`

- [ ] **Step 1: Add the two functions**

Append at the bottom of `portal/src/lib/api.js`, before the file's `export` block (or following existing exports — match the file's pattern):

```js
export async function fetchPTSessions({ from, to, locationSlug, statuses }) {
  const params = new URLSearchParams({ from, to, location_slug: locationSlug })
  if (statuses && statuses.length) params.set('status', statuses.join(','))
  const r = await authedFetch(`/reports/pt-sessions?${params.toString()}`)
  if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`)
  return r.json()
}

export async function fetchPTSessionsTrainer(employeeId, { from, to, locationSlug, statuses }) {
  const params = new URLSearchParams({ from, to, location_slug: locationSlug })
  if (statuses && statuses.length) params.set('status', statuses.join(','))
  const r = await authedFetch(`/reports/pt-sessions/trainer/${encodeURIComponent(employeeId)}?${params.toString()}`)
  if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`)
  return r.json()
}
```

If `authedFetch` is not the existing helper name, use whichever exported helper api.js uses for token-bearing fetches (read the file's first 30 lines to confirm).

- [ ] **Step 2: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat(portal): api client functions for pt-sessions report"
```

---

### Task 8: Portal report component

**Files:**
- Create: `portal/src/components/reports/PTSessionsReport.jsx`

- [ ] **Step 1: Create the component**

Create `portal/src/components/reports/PTSessionsReport.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react'
import { fetchPTSessions, fetchPTSessionsTrainer } from '../../lib/api'

const PRESET_RANGES = [
  { key: 'this-week',  label: 'This Week' },
  { key: 'this-month', label: 'This Month' },
  { key: 'last-30',    label: 'Last 30 Days' },
  { key: 'ytd',        label: 'YTD' },
  { key: 'custom',     label: 'Custom' },
]

function rangeFor(key) {
  const today = new Date()
  const fmt = (d) => d.toISOString().slice(0, 10)
  switch (key) {
    case 'this-week': {
      const day = today.getDay() // 0=Sun
      const monday = new Date(today); monday.setDate(today.getDate() - ((day + 6) % 7))
      return { from: fmt(monday), to: fmt(today) }
    }
    case 'this-month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: fmt(first), to: fmt(today) }
    }
    case 'last-30': {
      const ago = new Date(today); ago.setDate(today.getDate() - 30)
      return { from: fmt(ago), to: fmt(today) }
    }
    case 'ytd': {
      const jan = new Date(today.getFullYear(), 0, 1)
      return { from: fmt(jan), to: fmt(today) }
    }
    default:
      return { from: fmt(today), to: fmt(today) }
  }
}

export default function PTSessionsReport({ availableLocations = [], canSeeAll = false, defaultLocation = 'all' }) {
  const [rangeKey, setRangeKey] = useState('this-month')
  const [{ from, to }, setRange] = useState(rangeFor('this-month'))
  const [locationSlug, setLocationSlug] = useState(canSeeAll ? defaultLocation : (availableLocations[0]?.slug || ''))
  const [statuses, setStatuses] = useState(['Completed', 'Canceled-Charge'])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('total')
  const [sortDir, setSortDir] = useState('desc')
  const [expanded, setExpanded] = useState(null) // employee_id of expanded row
  const [drillCache, setDrillCache] = useState({}) // employee_id -> { sessions, loading }

  useEffect(() => {
    if (rangeKey !== 'custom') setRange(rangeFor(rangeKey))
  }, [rangeKey])

  useEffect(() => {
    if (!locationSlug) return
    let alive = true
    setLoading(true); setError(null)
    fetchPTSessions({ from, to, locationSlug, statuses })
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [from, to, locationSlug, statuses.join(',')])

  const sortedTrainers = useMemo(() => {
    if (!data) return []
    const rows = [...data.trainers]
    rows.sort((a, b) => {
      let va, vb
      if (sortKey === 'name') { va = a.employee_name; vb = b.employee_name }
      else if (sortKey === 'attendance') { va = a.total ? a.completed / a.total : 0; vb = b.total ? b.completed / b.total : 0 }
      else if (sortKey.startsWith('et:')) {
        const ev = sortKey.slice(3)
        va = (a.by_event_type[ev]?.completed || 0) + (a.by_event_type[ev]?.canceled_charge || 0)
        vb = (b.by_event_type[ev]?.completed || 0) + (b.by_event_type[ev]?.canceled_charge || 0)
      }
      else { va = a[sortKey]; vb = b[sortKey] }
      if (va === vb) return 0
      const cmp = va < vb ? -1 : 1
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [data, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  function toggleStatus(s) {
    setStatuses((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
  }

  async function toggleExpanded(employeeId) {
    if (expanded === employeeId) { setExpanded(null); return }
    setExpanded(employeeId)
    if (drillCache[employeeId]) return
    setDrillCache((c) => ({ ...c, [employeeId]: { loading: true, sessions: null } }))
    try {
      const d = await fetchPTSessionsTrainer(employeeId, { from, to, locationSlug, statuses })
      setDrillCache((c) => ({ ...c, [employeeId]: { loading: false, sessions: d.sessions } }))
    } catch (e) {
      setDrillCache((c) => ({ ...c, [employeeId]: { loading: false, sessions: [], error: e.message } }))
    }
  }

  function exportCsv() {
    if (!data) return
    const cols = ['Trainer', ...data.event_types.flatMap((e) => [`${e} (Completed)`, `${e} (Canceled-Charge)`]), 'Total', 'Completed', 'Canceled-Charge', '% Attended']
    const lines = [cols.join(',')]
    for (const t of sortedTrainers) {
      const row = [JSON.stringify(t.employee_name)]
      for (const ev of data.event_types) {
        row.push(t.by_event_type[ev]?.completed || 0)
        row.push(t.by_event_type[ev]?.canceled_charge || 0)
      }
      row.push(t.total, t.completed, t.canceled_charge, t.total ? Math.round((t.completed / t.total) * 100) + '%' : '')
      lines.push(row.join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `pt-sessions-${from}-to-${to}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (!locationSlug) return <div className="p-6">Select a location.</div>

  return (
    <div className="p-6 space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {PRESET_RANGES.map((p) => (
            <button key={p.key}
              onClick={() => setRangeKey(p.key)}
              className={`px-3 py-1 rounded ${rangeKey === p.key ? 'bg-red-600 text-white' : 'bg-gray-200'}`}>
              {p.label}
            </button>
          ))}
        </div>
        {rangeKey === 'custom' && (
          <>
            <input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="border rounded px-2 py-1" />
            <span>→</span>
            <input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="border rounded px-2 py-1" />
          </>
        )}
        {(canSeeAll || availableLocations.length > 1) && (
          <select value={locationSlug} onChange={(e) => setLocationSlug(e.target.value)} className="border rounded px-2 py-1">
            {canSeeAll && <option value="all">All Locations</option>}
            {availableLocations.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1"><input type="checkbox" checked={statuses.includes('Completed')} onChange={() => toggleStatus('Completed')} /> Completed</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={statuses.includes('Canceled-Charge')} onChange={() => toggleStatus('Canceled-Charge')} /> Canceled-Charge</label>
        <button onClick={exportCsv} className="ml-auto px-3 py-1 rounded bg-gray-200">Export CSV</button>
      </div>

      {error && <div className="text-red-600">Error: {error}</div>}
      {loading && <div>Loading…</div>}

      {data && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Total Sessions" value={data.summary.total_sessions} />
            <Stat label="Completed"      value={data.summary.completed} />
            <Stat label="Canceled-Charge" value={data.summary.canceled_charge} />
            <Stat label="Attendance"     value={data.summary.total_sessions ? Math.round(data.summary.attendance_rate * 100) + '%' : '—'} />
          </div>

          {/* Pivot table */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <Th onClick={() => toggleSort('name')}     active={sortKey === 'name'}     dir={sortDir}>Trainer</Th>
                  {data.event_types.map((ev) => (
                    <Th key={ev} onClick={() => toggleSort('et:' + ev)} active={sortKey === 'et:' + ev} dir={sortDir}>{ev}</Th>
                  ))}
                  <Th onClick={() => toggleSort('total')}      active={sortKey === 'total'}      dir={sortDir}>Total</Th>
                  <Th onClick={() => toggleSort('attendance')} active={sortKey === 'attendance'} dir={sortDir}>% Att</Th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedTrainers.map((t) => (
                  <Row key={t.employee_id} t={t} eventTypes={data.event_types} expanded={expanded === t.employee_id} onToggle={() => toggleExpanded(t.employee_id)} drill={drillCache[t.employee_id]} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-white rounded shadow p-3">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  )
}

function Th({ children, onClick, active, dir }) {
  return (
    <th onClick={onClick} className={`text-left px-3 py-2 cursor-pointer select-none ${active ? 'text-red-600' : ''}`}>
      {children}{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
}

function Row({ t, eventTypes, expanded, onToggle, drill }) {
  const att = t.total ? Math.round((t.completed / t.total) * 100) : 0
  return (
    <>
      <tr className="border-t hover:bg-gray-50">
        <td className="px-3 py-2 font-medium">{t.employee_name}</td>
        {eventTypes.map((ev) => {
          const c = t.by_event_type[ev]?.completed || 0
          const cc = t.by_event_type[ev]?.canceled_charge || 0
          const dim = (c + cc) === 0 ? 'text-gray-300' : ''
          return <td key={ev} className={`px-3 py-2 ${dim}`}>{c}/{cc}</td>
        })}
        <td className="px-3 py-2 font-semibold">{t.total}</td>
        <td className="px-3 py-2">{t.total ? att + '%' : '—'}</td>
        <td className="px-3 py-2"><button onClick={onToggle}>{expanded ? '▼' : '▶'}</button></td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50">
          <td colSpan={eventTypes.length + 4} className="px-3 py-2">
            {drill?.loading && <div>Loading sessions…</div>}
            {drill?.sessions && drill.sessions.length === 0 && <div>No sessions.</div>}
            {drill?.sessions && drill.sessions.length > 0 && (
              <table className="min-w-full text-xs">
                <thead className="text-gray-500">
                  <tr><th className="text-left">Date</th><th className="text-left">Time</th><th className="text-left">Member</th><th className="text-left">Event Type</th><th className="text-left">Status</th><th className="text-left">Attended</th></tr>
                </thead>
                <tbody>
                  {drill.sessions.map((s) => {
                    const dt = (s.event_timestamp_local || '').replace('T', ' ').slice(0, 16)
                    const [date, time] = dt.split(' ')
                    return (
                      <tr key={s.event_id} className="border-t border-gray-200">
                        <td className="py-1">{date}</td>
                        <td>{time}</td>
                        <td>{s.member_name || '—'}</td>
                        <td>{s.event_name}</td>
                        <td>{s.status}</td>
                        <td>{s.attended_status || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/reports/PTSessionsReport.jsx
git commit -m "feat(portal): PT Sessions report component (pivot + drill-down)"
```

---

### Task 9: Tile + route in ReportingView

**Files:**
- Modify: `portal/src/components/ReportingView.jsx`

- [ ] **Step 1: Read ReportingView.jsx**

Read the file. Identify (a) where the tile grid is rendered (look for an array of tile objects with `key`, `label`, `icon`), and (b) where the hash-route switch lives (a series of `if (route === '...')` or a `switch (route)` block, or a map). Note both patterns.

- [ ] **Step 2: Add the import**

Near the existing report imports, add:

```jsx
import PTSessionsReport from './reports/PTSessionsReport'
```

- [ ] **Step 3: Add the tile**

In the tile array (alongside Membership, Club Health, PT, Check-ins), add:

```jsx
{ key: 'pt-sessions', label: 'PT Sessions', route: 'pt-sessions', accessKey: 'pt-sessions' }
```

(Match the exact field names used by the existing tiles. If the existing tiles use `icon`, supply the same SVG style as the PT/Day One tile.)

- [ ] **Step 4: Add the route rendering**

In the route-rendering switch, add a case for `'pt-sessions'`:

```jsx
{route === 'pt-sessions' && (
  <PTSessionsReport
    availableLocations={availableLocations}
    canSeeAll={canSeeAllLocations}
    defaultLocation={defaultLocation}
  />
)}
```

(Names of the props passed should match what the existing reports — e.g. `MembershipReport` or `CheckinsReport` — receive. If those reports take different prop names like `locations` instead of `availableLocations`, rename the props in `PTSessionsReport.jsx` to match.)

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/ReportingView.jsx
git commit -m "feat(portal): wire PT Sessions tile + route into Reporting"
```

---

### Task 10: PR, deploy, backfill, smoke test

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin feat/pt-sessions-report
gh pr create --title "feat: PT Sessions report (pivot + drill-down) backed by abc_calendar_events" --body "Implements docs/superpowers/specs/2026-05-07-pt-sessions-design.md. New abc_calendar_events table, ghl-sync delta hook + backfill, /reports/pt-sessions endpoints, desktop tile + drill-down. Migration is already applied to prod."
```

- [ ] **Step 2: Wait for user to merge**

Once merged, ghl-sync and auth API and portal will all auto-deploy.

- [ ] **Step 3: Run the backlog from Render Shell on ghl-sync**

```
cd ~/project/src/ghl-sync
bash scripts/backfill-cal-fast.sh 2026-01-01 $(date -u +%Y-%m-%d)
```

Expected: 4 PIDs (kicked off in parallel), tails showing pages of appointments being upserted.

- [ ] **Step 4: Verify rows arriving**

Run via Supabase MCP:

```sql
SELECT club_number, COUNT(*) AS rows, MIN(event_timestamp) AS earliest, MAX(event_timestamp) AS latest
FROM abc_calendar_events
GROUP BY club_number
ORDER BY club_number;
```

Expected (over ~30 min as backfill progresses): every club_number has rows, earliest hovering near 2026-01-01.

- [ ] **Step 5: Smoke-test the endpoint**

From a logged-in portal session token (or via the portal UI directly):

- Open Reporting → PT Sessions tile
- Default range "This Month", default location (your assigned)
- Confirm trainers list and counts look right (cross-check Salem with ABC dashboard for 1 known trainer)
- Click a trainer with sessions → confirm drill-down list matches ABC

- [ ] **Step 6: CSV export check**

Click Export CSV → open → confirm pivot numbers match the table.

- [ ] **Step 7: Commit any final polish**

If the smoke test surfaces field-name mismatches or styling issues, fix and commit.

---

## Self-Review

**Spec coverage check:**
- ✅ Sync filter (`Appointment` + Completed/Canceled-Charge) — Task 2
- ✅ `abc_calendar_events` schema — Task 1
- ✅ Delta hook every 10 min covering ±7d window — Task 5
- ✅ Backfill from 2026-01-01 — Task 3 + Task 10 step 3
- ✅ `/reports/pt-sessions` pivot endpoint — Task 6
- ✅ `/reports/pt-sessions/trainer/:employee_id` drill-down — Task 6
- ✅ Per-location auth gate (matches checkins) — Task 6
- ✅ `lead+` role gate via REPORT_ACCESS — Task 6
- ✅ Pivot UI with sortable columns + summary cards — Task 8
- ✅ Drill-down expandable rows — Task 8
- ✅ CSV export — Task 8
- ✅ Tile in ReportingView — Task 9
- ✅ Desktop only (no mobile) — explicit in plan
- ✅ Indexes on (club_number, event_timestamp), (employee_id, event_timestamp), event_type_id — Task 1

**Type/name consistency:**
- `syncCalendarEventsForClub` — same signature in Task 2 module export, Task 3 backfill, Task 5 delta hook
- `fetchPTSessions` / `fetchPTSessionsTrainer` — defined in Task 7, used in Task 8
- `event_types` field in API response (Task 6) — consumed by Task 8 sort/render
- `by_event_type[ev].completed/canceled_charge` shape — produced in Task 6, consumed in Task 8 + CSV export

**Placeholder scan:** No TBDs, TODOs, or "implement appropriate X" lines.

**Open notes for the implementer:**
- DST handling in `parseAbcTimestamp` is approximate (manual DST detection, not a TZ library). Acceptable for reporting since boundary errors only affect events within the 1h DST gap. If a TZ library (`luxon`, `date-fns-tz`) is already in the repo, swap it in.
- The `getStaffLocations` and `resolveSlugToClub` services referenced in Task 6 — verify they exist with those names in `auth/src/services/`. If not, copy the equivalent from `auth/src/routes/checkinsReport.js` (which already does the per-location auth gate).
