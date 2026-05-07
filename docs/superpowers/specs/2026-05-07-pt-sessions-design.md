# PT Sessions Report — Design

**Date:** 2026-05-07
**Status:** Approved (pending user review of this written spec)
**Scope:** Desktop reporting only

## Goal

Add a "PT Sessions" tile to the Reporting view that gives managers and trainers a clear view of training-session load per trainer, plus the ability to drill into individual sessions for a date range. Two primary use cases:

1. Determine weekly/monthly load per trainer based on session count and session type.
2. Run a date-bounded report by trainer × event type for compensation/performance review.

## Data Source

ABC Financial calendar events API:
```
GET https://api.abcfinancial.com/rest/{clubNumber}/calendars/events
  ?eventDateRange={fromDate},{toDate}
  &eventStatus={completed|canceled-charge}
  &size=200
  &page={n}
```

Headers: `app_id`, `app_key` (already in `ghl-sync` env). Pagination via `status.nextPage`.

**Filter at sync time:** `category='Appointment'` AND `status IN ('Completed','Canceled-Charge')`. Group classes (`category='Class'`) and pending/scheduled events are excluded — this is a "delivered work" report, not a calendar feed.

## Architecture

```
┌─────────────────┐   delta every 10 min            ┌──────────────────────┐
│   ABC API       │ ←─────── ghl-sync   ──────────→ │ abc_calendar_events  │
│ /calendars/     │   filter: Appointment +         │ table (Supabase)     │
│   events        │     Completed/Canceled-Charge   │                      │
└─────────────────┘                                 └──────────────────────┘
                                                              ↑
                                                       SQL aggregation
                                                              ↓
                                                    ┌──────────────────────┐
                                                    │ auth API:            │
                                                    │ /reports/pt-sessions │
                                                    └──────────────────────┘
                                                              ↑
                                                       JSON response
                                                              ↓
                                                    ┌──────────────────────┐
                                                    │ Portal:              │
                                                    │ PTSessionsReport.jsx │
                                                    └──────────────────────┘
```

Three components:

1. **ghl-sync** — new `src/abc/calendarEvents.js` module + delta hook + backfill script. Mirrors the `checkins.js` pattern.
2. **Auth API** — new `auth/src/routes/ptSessions.js` mounted at `/reports/pt-sessions`. Aggregation in SQL.
3. **Portal** — new `portal/src/components/reports/PTSessionsReport.jsx` + new tile in `ReportingView.jsx`. **Desktop only.**

## Data Model

```sql
CREATE TABLE abc_calendar_events (
  club_number               TEXT NOT NULL,
  event_id                  TEXT NOT NULL,
  event_type_id             TEXT,
  event_name                TEXT,            -- "PT 60MIN", "PT60", "30MIN STRETCH"
  category                  TEXT,            -- always "Appointment" (only category we sync)
  event_timestamp           TIMESTAMPTZ,     -- parsed assuming America/Los_Angeles
  event_timestamp_local     TIMESTAMP,       -- raw ABC value, no TZ
  status                    TEXT,            -- "Completed" or "Canceled-Charge"
  duration_minutes          INTEGER,
  employee_id               TEXT,
  employee_first_name       TEXT,
  employee_last_name        TEXT,
  location_id               TEXT,
  location_name             TEXT,
  training_level            TEXT,
  earnings_code             TEXT,
  member_id                 TEXT,            -- members[0] (Appointments have 0 or 1)
  member_first_name         TEXT,
  member_last_name          TEXT,
  attended_status           TEXT,            -- "Did Not Attend" / "Attended" / "Pending"
  modified_timestamp_abc    TIMESTAMPTZ,     -- for incremental delta sync
  fetched_at                TIMESTAMPTZ DEFAULT now(),
  raw                       JSONB,
  PRIMARY KEY (club_number, event_id)
);

CREATE INDEX abc_cal_events_club_time     ON abc_calendar_events (club_number, event_timestamp);
CREATE INDEX abc_cal_events_employee_time ON abc_calendar_events (employee_id, event_timestamp);
CREATE INDEX abc_cal_events_event_type    ON abc_calendar_events (event_type_id);
```

**Volume:** ~7 clubs × ~30 sessions/day × 365 days × 2 statuses ≈ 75–100K rows/year. Tiny.

**Time storage:** Two columns. `event_timestamp_local` is the raw ABC string-as-timestamp (e.g. `2026-04-01 05:00:00`); `event_timestamp` is the same value parsed assuming `America/Los_Angeles`. All WCS clubs are in Pacific so DST is handled correctly. Aggregations group by `event_timestamp_local::date` to avoid TZ-edge weirdness.

**`raw` JSONB** stores the full ABC event so we can derive new columns later without re-syncing.

## Sync Pipeline

### `ghl-sync/src/abc/calendarEvents.js`

```js
fetchCalendarEvents(clubNumber, fromDate, toDate, status, page = 1)
  → GET .../events?eventDateRange={from},{to}&eventStatus={status}&size=200&page={page}
  → returns { events, nextPage }

syncCalendarEventsForClub(clubNumber, fromDate, toDate, statuses = ['completed','canceled-charge'])
  → for each status: walk pages, filter category='Appointment', upsert
```

Each page upserts rows in chunks of 500. Idempotent via `(club_number, event_id)` PK.

### Delta hook

In `ghl-sync/src/sync/deltaSync.js`, after the existing GHL+check-ins blocks, call:

```js
await syncCalendarEventsForClub(club.clubNumber, sevenDaysAgo, endOfTomorrow);
```

Window covers (a) sessions completed in the past week and (b) status flips from Pending → Completed/Canceled-Charge for sessions that already happened. Runs every 10 minutes via the existing delta loop.

### Backfill

`ghl-sync/scripts/backfill-calendar-events.js`:

```bash
node scripts/backfill-calendar-events.js \
  --from 2026-01-01 \
  --to   2026-05-07 \
  [--clubs 30935,31599,...] \
  [--sleep 100]
```

Plus `ghl-sync/scripts/backfill-cal-fast.sh` mirroring `backfill-fast.sh`: kills any running process, spawns one per club in parallel.

**Initial backlog rollout:** seed Jan 1, 2026 → today for all 7 clubs. Wall time at sleep 100 with 4-up parallel: ~5–6h.

## Auth API Endpoint

### `GET /reports/pt-sessions`

Auth: `requireRole('lead')`.

Query params:
- `from`, `to` — required, ISO date strings
- `location_slug` — required. `'all'` only allowed for `marketing/corporate/admin/director`; lead/manager are forced to one of their `report_location_ids` (matches `/reports/checkins` per-location gate).
- `status` — optional, comma-separated, default `Completed,Canceled-Charge`
- `event_type_ids` — optional, comma-separated; default = all

Response:

```json
{
  "summary": {
    "total_sessions":    412,
    "completed":         380,
    "canceled_charge":    32,
    "attendance_rate":  0.92
  },
  "trainers": [
    {
      "employee_id":   "E581...",
      "employee_name": "Seth Tripp",
      "total":         142,
      "completed":     134,
      "canceled_charge": 8,
      "by_event_type": {
        "PT 60MIN":      { "completed": 110, "canceled_charge": 6 },
        "PT60":          { "completed":  20, "canceled_charge": 2 },
        "30MIN STRETCH": { "completed":   4, "canceled_charge": 0 }
      }
    }
  ],
  "event_types": ["PT 60MIN", "PT60", "30MIN STRETCH"]
}
```

Implemented as one SQL aggregation that joins on `abc_calendar_events`, groups by `(employee_id, employee_first_name, employee_last_name, event_name, status)`, and pivots in JS.

`event_types` array is the union of distinct `event_name` values present in the result, ordered by total session count descending. Used by the UI as the column ordering for the pivot.

### `GET /reports/pt-sessions/trainer/:employee_id`

Same auth + filter params. Returns the individual sessions for one trainer in the date/location/status window:

```json
{
  "sessions": [
    {
      "event_id": "619c...",
      "event_timestamp_local": "2026-04-01T05:00:00",
      "event_name": "PT 60MIN",
      "status": "Completed",
      "duration_minutes": 60,
      "member_id": "1db2...",
      "member_name": "Claudia Reischke",
      "attended_status": "Attended",
      "location_name": "Club"
    }
  ]
}
```

Sorted by `event_timestamp` desc.

## UI

### Tile in `ReportingView.jsx`

New "PT Sessions" tile in the existing tile grid. Same red SVG icon style, label `PT Sessions`. Click → opens the report in the existing reporting hash route style (e.g. `#reporting/pt-sessions`).

### `portal/src/components/reports/PTSessionsReport.jsx`

Layout:

```
┌──────────────────────────────────────────────────────────────────┐
│ Date Range: [This Week] [This Month] [Last 30] [YTD] [Custom]    │
│ Location:   [All*] [Salem] [Keizer] ...  (*corporate roles only) │
│ Status:     ☑ Completed   ☑ Canceled-Charge                      │
├──────────────────────────────────────────────────────────────────┤
│ ┌─ Summary ──────────────────────────────────────────────┐       │
│ │ Total: 412  Completed: 380  Canceled-Charge: 32        │       │
│ │ Attendance: 92%                                        │       │
│ └────────────────────────────────────────────────────────┘       │
├──────────────────────────────────────────────────────────────────┤
│ Trainer       │ PT 60MIN │ PT60 │ 30MIN STR │ Total │ % Att │ ▼ │
│ ───────────── │ ──────── │ ──── │ ───────── │ ───── │ ───── │   │
│ Seth Tripp    │  110/8   │ 20/2 │   4/0     │  144  │  93%  │ ▶ │
│ Baley Hould.. │   88/4   │ 14/1 │   2/0     │  109  │  95%  │ ▶ │
└──────────────────────────────────────────────────────────────────┘
```

**Behaviors:**

- Cell format: `completed/canceled-charge` (e.g. `110/8`); `0/0` cells render dimmed.
- Default sort: Total desc. Click any column header to re-sort.
- Click `▶` on a row → fetches `/reports/pt-sessions/trainer/:employee_id` and expands inline below the row showing individual sessions: Date, Time, Member, Event Type, Status, Attended.
- CSV export button (matches existing reports — exports the pivot).
- Date-range pills + custom date pickers match the existing Membership/Check-ins reports.
- Status filter is a pair of checkboxes (Completed default-checked, Canceled-Charge default-checked). Unchecking either filters the response.

### Role gate

- `lead` and above can view (matches existing reports).
- Per-location auth gate identical to `/reports/checkins`: lead/manager must specify a single `location_slug` from their `staff_locations.report_location_ids`; `marketing/corporate/admin/director` can use `'all'`.

## Mobile

**Out of scope for this iteration.** Desktop-only.

## Testing

- Unit-test the SQL aggregation against a fixture dataset (10 events across 2 trainers, 3 event types, both statuses) — assert summary counts and pivot shape.
- Manual smoke test post-deploy:
  1. Run backfill from 2026-01-01 → today.
  2. Open the tile, default range = This Month → confirm trainers and counts match Salem's known weekly cadence.
  3. Expand a trainer with known recent sessions → confirm individual session list matches ABC dashboard.
  4. CSV export → open in Excel, confirm same numbers.

## Rollout

1. Migration `005_abc_calendar_events.sql` applied to prod.
2. Deploy ghl-sync with the new module + delta hook + backfill script.
3. Run backfill from 2026-01-01 → today via parallel helper.
4. Deploy auth API with the two new routes.
5. Deploy portal with the new tile + report component.
6. Smoke-test the report.

Each step is reversible: removing the tile / route / migration drops the feature without touching any other report.

## Open questions

None at design time. Future enhancements that are NOT in scope here but worth noting:

- Stacked-bar trend chart (sessions/week, stacked by event type) — explicitly deferred (Approach C).
- Mobile parallel — explicitly deferred (user said desktop-only).
- Group-class reporting (multi-member events) — would need a separate join table; out of scope.
- Per-trainer commission/payout calculations — separate report, separate spec.
