# Group X Scheduler + Attendance + Public Class Board

**Date:** 2026-07-30
**Repo:** wcs-staff-portal
**Branch:** feat/group-x-scheduler

## Problem

WCS has no tool for managing the group exercise schedule. Classes are created by hand in ABC,
there is no week-at-a-glance view for staff, no record of how many people actually showed up,
and no way to answer "which classes are worth keeping". Members have no published schedule.

## Goals

1. A Google-Calendar-style week view of Group X classes per club, admin-managed.
2. Create a class (single or weekly recurring series) that lands in ABC as a real event.
3. Log a headcount after each class, stored in Supabase.
4. Report on class performance so we can cut or expand classes on evidence.
5. A public, pretty Monday-Sunday board for the website and in-gym TVs.

## Non-goals

- Member self-booking of classes (ABC supports it; nobody uses it).
- Per-member class attendance rosters. See "ABC findings" below.
- Two-way sync of class edits made directly inside ABC.
- Any Group X data on mobile or in the existing PT Scheduler.

## ABC API findings (verified live 2026-07-30)

All verified against the production ABC API with the portal's `ABC_APP_ID` / `ABC_APP_KEY`.

### Class catalog: `GET /rest/{club}/calendars/eventtypes`

Returns 21 event types per club, 6 with `category: "class"`. **Identical at all 7 clubs:**

| Class | maxAttendees | duration | isAvailableOnline |
|---|---|---|---|
| Barbell Strength | 10 | 60 | true |
| Bootcamp | 12 | 60 | true |
| SMALL GROUP TRAINING | 15 | 60 | false |
| StrongHer | 10 | 60 | true |
| Yoga | 10 | 60 | true |
| Yoga SX | 15 | 60 | false |

Each type also carries `description`, `eventTrainingLevels[]`, `isTrackAttendance`,
`isMemberRequiredToCreate: "false"`, `isEmployeeRequiredToCreate: "true"`.

This endpoint is **not currently used anywhere in the codebase**. The existing
`GET /abc-scheduler/event-types` mines distinct event types out of 180 days of cached
`abc_calendar_events` rows, which is why it only ever surfaced "SMALL GROUP TRAINING" —
that was the only class type with recent completed events.

`/rest/{club}/clubs/eventtypes`, `/calendars/classes`, `/clubs/classes` all 404.

### Creating a class

`isMemberRequiredToCreate: false` and `isEmployeeRequiredToCreate: true` mean a class is
created from `eventTypeId` + `employeeId` + `eventTimestamp`, with no member attached.
Write endpoints were confirmed by an ABC rep on 2026-05-12 and already proxied in
`auth/src/routes/abcScheduler.js`:

```
POST   /{club}/calendars/events
DELETE /{club}/calendars/events/{eventId}
```

### Reading classes

`GET /{club}/calendars/events?eventDateRange=YYYY-MM-DD,YYYY-MM-DD&size=200`

With **no** `eventStatus` filter, ABC returns both future and past events. Observed statuses:
`Pending` (future/unmarked) and `Completed`. Class events come back with
`category: "Class"` (capitalized in event responses, lowercase `"class"` in the
eventtypes response — do not compare across the two without normalizing).

Salem already has a live class schedule in ABC (Bootcamp, Barbell Strength, Yoga running
through July 2026). Any write path we build touches a real, in-use calendar.

### Attendance is a dead end in ABC

Of 37 Salem class events in July 2026: 31 had **zero** members attached, and the other 6 had
exactly one member, all marked "Did Not Attend". Nobody books classes through ABC.

Confirmed in Supabase: `abc_calendar_events` holds only 35 `category='Class'` rows across all
clubs and all time, all one event type. The cache is also incomplete by design — ghl-sync only
pulls `completed` + `canceled-charge`, so future `Pending` classes never land there.

**Therefore:** headcount is staff-entered into Supabase. ABC is not consulted for attendance.

### Instructors: `GET /rest/{club}/employees`

`employment.departments.department` is a real, populated array. Active-employee counts:

| Club | Group Exercise | Personal Trainers |
|---|---|---|
| Salem (30935) | 1 | 11 |
| Keizer (31599) | 1 | 11 |
| Medford (32073) | 2 | 10 |

Per decision, the instructor dropdown includes **Group Exercise + Personal Trainers**, with
Group Exercise sorted first.

Note: the Supabase `abc_employees` table has `department` and `position` **NULL for all 577
rows** — that sync never captured them. The instructor list reads live from ABC rather than
depending on fixing that sync.

## Decisions

| Decision | Choice |
|---|---|
| Recurrence | Recurring weekly series + one-off classes |
| Attendance | Headcount only, one number per class |
| Access | Admin only (same gate as PT Scheduler) |
| Instructors | ABC Group Exercise + Personal Trainers departments |
| Public page host | Standalone page served by the auth API |
| TV layout | Full Mon-Sun week grid, today's column highlighted |
| Class card | Time, class name, instructor |

## Architecture

### Why not extend PT Scheduler

`portal/src/components/admin/PtSchedulerView.jsx` is 1147 lines and member-centric: session
balances, per-member booking, per-member attendance. A class has an instructor and a headcount
and no members. Bolting a second mode onto that file makes both harder to change.

**Shared instead:** the week-grid and timestamp primitives currently trapped inside
`PtSchedulerView.jsx` get extracted so both features import one copy.

- `auth/src/lib/abcTime.js` — `isDstPacific`, `parseAbcTs`, `padDate`, `fmtAbcDate`.
  Currently duplicated inside `abcScheduler.js`. ABC returns naive club-local Pacific
  timestamps; this is the single place that knows it.
- `portal/src/lib/weekGrid.js` — `startOfWeek`, `addDays`, `toISODate`, `fmtHour`,
  `fmtTime12`, `parseLocalTimestamp`, `layoutLanes`.

`PtSchedulerView.jsx` and `abcScheduler.js` are updated to import from these and their local
copies deleted. No behavior change to PT Scheduler.

### Source of truth

**ABC owns what is scheduled. Supabase owns how it went.**

There is no local mirror of the class schedule, so there is nothing to reconcile when someone
edits a class directly in ABC. Supabase rows are keyed by ABC's `eventId` and hold only the
headcount and the series linkage.

## Data model

New migration `auth/migrations/093_group_x.sql` (numbering follows 092).

This repo has **no migration runner** — the SQL must be applied to prod Supabase by hand after
merge.

```sql
create table group_x_series (
  id                uuid primary key default gen_random_uuid(),
  club_number       text not null,
  event_type_id     text not null,
  class_name        text not null,
  employee_id       text not null,
  instructor_name   text not null,
  weekdays          smallint[] not null,      -- 0=Sun .. 6=Sat
  start_time        time not null,            -- club-local Pacific
  duration_minutes  int not null,
  training_level_id text,
  starts_on         date not null,
  ends_on           date not null,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  canceled_at       timestamptz,
  canceled_by       text
);
create index on group_x_series (club_number, starts_on, ends_on);

create table group_x_class_attendance (
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
create index on group_x_class_attendance (club_number, event_timestamp);
```

Both tables get `alter table ... enable row level security;` with **no policy** — the portal DB
is 100% service-role, and every public table must have RLS on.

**Upserts must send whole rows.** A partial `.upsert()` fails NOT NULL columns even when the
row already exists. This has broken the Operandio sync before.

## Backend

### `auth/src/routes/groupX.js` — admin only

Mounted `app.use('/group-x', require('./routes/groupX'))`, gated by
`authenticate` + `requireRole('admin')`.

| Method | Path | Behavior |
|---|---|---|
| GET | `/class-types?club_number=` | Live ABC `/calendars/eventtypes`, filtered to `category === 'class'`. Returns `{event_type_id, name, description, duration, max_attendees, training_levels[]}`. Cached 1h via existing `memoryCache.js`. |
| GET | `/instructors?club_number=` | Live ABC `/employees`, `employeeStatus === 'active'`, department ∈ {Group Exercise, Personal Trainers}. Group Exercise first, then alpha. Returns `{employee_id, display_name, department}`. Cached 1h. |
| GET | `/classes?club_number=&start=&end=` | Live ABC `/calendars/events`, no status filter, `category === 'Class'`, date range padded ±1 day for the Pacific/UTC edge then trimmed. Left-joined to `group_x_class_attendance` on `abc_event_id`. Returns each class with `headcount` (null if unlogged) and `needs_attendance` (past + no headcount). |
| POST | `/classes` | Create one class. Body `{club_number, event_type_id, employee_id, date, time, duration_minutes, training_level_id?}`. |
| POST | `/series` | Create a recurring series. See below. |
| DELETE | `/classes/:eventId?club_number=` | Cancel one occurrence in ABC. |
| DELETE | `/series/:id?from=YYYY-MM-DD` | Cancel the series' occurrences on/after `from`. Sets `canceled_at`. |
| PUT | `/classes/:eventId/attendance` | Body `{club_number, headcount, notes?, ...class fields}`. Whole-row upsert into `group_x_class_attendance`. |
| GET | `/report?club_number=&start=&end=` | Performance rollup. `club_number=all` supported. |

### Series creation

`POST /group-x/series` body:
`{club_number, event_type_id, employee_id, weekdays[], start_time, duration_minutes, starts_on, ends_on, training_level_id?}`

1. Expand `(weekdays, start_time, starts_on..ends_on)` into a list of occurrence timestamps.
2. **Hard cap 200 occurrences.** Over the cap returns 400 with the computed count, no writes.
3. Insert the `group_x_series` row first, so a crash mid-fan-out still leaves a record.
4. POST each occurrence to ABC **sequentially** (not parallel — this is a rate-limited
   production API and ordering makes partial failure legible).
5. Collect `{date, ok, event_id | error}` per occurrence.
6. Return `201` with `{series_id, created: n, failed: m, occurrences: [...]}`.

**Partial failure is reported honestly.** If 34 of 39 land, the response and the UI both say
"34 created, 5 failed" with the failing dates and ABC's error. No silent success.

The UI shows the exact occurrence count and date list, and requires confirmation, **before**
any ABC write. These are real events on a live club calendar.

### `auth/src/routes/publicGroupX.js` — no auth

Mounted at `/public/group-x`.

**CORS:** the global `cors()` in `auth/src/index.js` is restricted to `ALLOWED_ORIGINS` and is
mounted with no path, so it handles OPTIONS preflight for every URL. A permissive
`cors({ origin: '*', methods: ['GET'] })` scoped to `/public/group-x` **must be mounted before
the global CORS middleware**, or preflight from westcoaststrength.com fails. This exact
ordering bug has bitten the prospects repo before.

| Method | Path | Behavior |
|---|---|---|
| GET | `/schedule?club=salem[&week=YYYY-MM-DD]` | JSON. Monday-Sunday week (defaults to the current Pacific week). Served from cache. |
| GET | `/board?club=salem` | Self-contained HTML page. The website iframe target and the TV URL. |

**Caching and rate limiting.** Seven TVs polling live would hammer ABC. The public endpoints
serve a per-club in-memory snapshot refreshed at most every 5 minutes; requests inside that
window are served from cache without touching ABC. A stale-on-error fallback keeps the board
up if ABC is down — an old schedule beats a blank TV. Club slug is validated against the known
7; anything else 404s rather than proxying an arbitrary club number.

The public payload is deliberately thin: date, start time, class name, instructor first name +
last initial, duration. No member data, no headcounts, no employee IDs.

## Frontend — staff

New tile "Group X", admin only, opening `portal/src/components/groupx/`:

- `GroupXView.jsx` — shell: club selector, week nav, "needs attendance" strip, week grid.
- `WeekGrid.jsx` — Sun-Sat grid using the extracted `weekGrid.js` helpers, class blocks
  colored by class type, past-with-no-headcount blocks badged.
- `CreateClassModal.jsx` — single class: type, instructor, date, time, duration.
- `CreateSeriesModal.jsx` — series builder with weekday toggles, date range, live occurrence
  count, confirmation step listing every date, then the partial-failure result view.
- `AttendanceModal.jsx` — headcount number input + optional note.
- `GroupXReport.jsx` — performance report.

Every content block wraps in a `bg-surface` card — the portal renders over a dark backdrop and
unwrapped content is invisible.

## Frontend — public board

`GET /public/group-x/board?club=salem` returns one self-contained HTML document: inlined CSS,
no build step, no external fetches beyond its own `/schedule` endpoint.

- Monday-Sunday, 7 columns, current day's column highlighted.
- Each class block: start time, class name, instructor.
- Auto-refreshes every 5 minutes and re-derives the current week from the client clock, so a
  TV left running for months rolls over to the new week on its own at midnight Monday.
- WCS branding: navy + WCS red, Inter, gym name and week range in the header.
- Responsive: readable from across a gym floor at 1080p/4K, and legible in a narrow iframe
  on the website. Below a breakpoint the 7-column grid becomes a stacked day list.
- Days with no classes render as an empty column, not a "no classes" row — reports and
  displays omit empty entries rather than announcing them.

## Reporting

`GET /group-x/report` returns, over a date range, for one club or all:

- Per class type: sessions held, total attendees, avg headcount, fill rate
  (headcount / maxAttendees), trend vs the previous equivalent period.
- Per instructor: sessions, avg headcount, fill rate.
- Per day-of-week and per time-of-day bucket: avg headcount.

Classes with no logged attendance in the range are **omitted entirely** — no rows stating a
class had nothing.

Fill rate is only meaningful where `max_attendees` is known; rows without it show avg headcount
and a dash for fill rate rather than a fabricated percentage.

## Testing

- Unit: series expansion (weekday sets, DST boundary weeks, `ends_on` inclusivity, the 200 cap).
- Unit: `abcTime.js` Pacific parsing across the March and November DST transitions.
- Unit: report aggregation, including the omit-empty rule and the missing-`max_attendees` case.
- Unit: public payload shaping — asserts no member data, employee IDs, or headcounts leak.
- Integration: read paths against a recorded ABC fixture.
- Manual, in this order, before any series fan-out is wired: create ONE class at ONE club with
  ONE type, confirm it in the ABC UI, then cancel it and confirm it's gone.

## Risks

1. **Every write hits production ABC immediately.** Salem's real class schedule lives there.
   Mitigated by: single-class manual verification first, occurrence-list confirmation before
   fan-out, the 200 cap, and no bulk-edit path.
2. **Public endpoint is unauthenticated.** Mitigated by: club slug allowlist, 5-minute cache,
   thin payload, GET only.
3. **Only 1-2 staff per club are tagged Group Exercise in ABC.** Including Personal Trainers
   makes the dropdown usable today; tagging real GX instructors in ABC remains an ops task.
4. **ABC's `category` casing differs between endpoints** (`"class"` vs `"Class"`). Normalized
   in one place in `groupX.js`.

## Delivery

Separate PRs off master, each independently mergeable:

| PR | Scope |
|---|---|
| A | Migration 093 + `abcTime.js` / `weekGrid.js` extraction + `groupX.js` read endpoints (class-types, instructors, classes) |
| B | Staff calendar UI: week grid, single-class create, cancel |
| C | Recurring series: `POST /series`, `DELETE /series/:id`, series builder UI |
| D | Attendance: `PUT /attendance`, needs-attendance strip, attendance modal |
| E | Public board: `publicGroupX.js`, CORS ordering fix, `/schedule` + `/board` |
| F | Performance report |

## Post-merge ops

1. Apply `auth/migrations/093_group_x.sql` to prod Supabase by hand.
2. Confirm `wcs-auth-api` redeployed on Render.
3. Tag real Group Exercise instructors in ABC per club.
4. Add the board iframe to the WordPress site.
5. Point each gym's TV browser at `/public/group-x/board?club=<slug>`.
