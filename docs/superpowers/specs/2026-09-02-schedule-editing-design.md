# Editing scheduled classes and facility events

**Date:** 2026-09-02
**Surfaces:** Group X Scheduler, Courts & Pool
**Status:** approved, not yet implemented

## Problem

Neither scheduler can change anything. To move a class thirty minutes a manager
cancels it and retypes it into the Add class form. To change an instructor for a
repeating class they do that once per occurrence. The only bulk operation that
exists is cancellation.

Alongside that, repeating classes are managed from a collapsed `SeriesList`
panel on the toolbar which lists series by name and time only. Nothing on the
grid says which classes belong to a series, so matching a row in the panel to a
block on the calendar is done by eye.

## What we are building

Clicking a class or event opens an edit modal instead of a read-only popover.
It can change the class, the instructor, the day and the time, plus the length
on Courts & Pool. When the class belongs to a repeating series it can apply the
change to that one occurrence or to every occurrence from that one onward, and
it can end the series at that point. The separate `SeriesList` panel goes away.

Both grids also move from Sunday-anchored to Monday-anchored, matching the
printed sheet and the public TV board.

## The constraint that shapes everything

Courts & Pool events are ours. `facility_events` (migration 096) is the source
of truth, with a real `series_id` foreign key and its own `title`, `staff_name`,
`starts_at_local` and `duration_minutes` columns. Editing is an `UPDATE`.

Group X classes are not ours. They live on the ABC calendar, and:

- **There is no event-update endpoint.** `PUT /{club}/calendars/events/{id}` is
  a 405 for every body shape. An edit is a delete followed by a create, so the
  ABC event id changes.
- **Length is not writable at all.** Duration is a property of the ABC event
  type; `duration` on create is silently ignored and the event-type endpoints
  are 405. Changing the class changes the length; there is no length field.
- **There is no series link.** Migration 093 says it outright: *"There is
  deliberately no local mirror of the class schedule."* `group_x_series` holds
  the series definition, but the ABC event ids it creates are discarded
  (`groupX.js:441` has `event_id` in hand and drops it). `series_id` appears
  only on `group_x_class_attendance`, and that row does not exist until someone
  logs a headcount.

So the Group X half needs a series link before it can offer "all from here on",
and its saves need to survive an id change without orphaning anything.

## Decisions

**Editing is offered on today-and-later classes only.** A past class keeps the
current read-only popover. This is what makes the Group X half safe: a past
class is never deleted, so a logged headcount can never be lost to a rebuild.
Retroactively correcting a class that already ran has little value and carries
the entire orphaning risk.

**"All from here on" rebuilds every future occurrence, with a preview.** It
reuses the two-step shape the create-series wizard already has: show the exact
dates and the count, require confirmation, then apply sequentially and report
partial failure as partial failure. Changing only the series definition and
leaving already-created ABC classes alone was rejected: the calendar would
disagree with the series for months.

**`SeriesList` is removed entirely.** Accepted trade-off: a series whose next
occurrence is several weeks out now requires paging forward to reach. Only live
series have future occurrences, so this is paging, not a dead end.

## Component 1: the Group X series link

### Migration 182

```sql
create table if not exists group_x_series_events (
  club_number   text not null,
  abc_event_id  text not null,
  series_id     uuid not null references group_x_series(id) on delete cascade,
  event_date    date not null,
  primary key (club_number, abc_event_id)
);

create index if not exists group_x_series_events_series_idx
  on group_x_series_events (series_id, event_date);

alter table group_x_series_events enable row level security;
```

RLS on with no policy, matching every other table in this schema. This repo has
no migration runner; applied by hand to prod Supabase at merge.

### Where rows are written

Three places that already hold both ids:

1. `POST /group-x/series` — inside the existing fan-out loop, for each `r.ok`.
2. `groupXSeriesTopUp` — the nightly job that extends open-ended series.
3. The new edit path — a rebuilt occurrence re-links to its series.

### Reading the link

`GET /group-x/classes` left-joins `group_x_series_events` on
`(club_number, abc_event_id)` and returns `series_id` on each class, exactly as
it already joins `group_x_class_attendance` for `headcount`.

Classes created before this ships have no row. For those, a **shape-match
fallback** infers the series: same club, same `event_type_id`, same
`employee_id`, same wall-clock start time, and the date falls on one of the
series' `weekdays` inside its live range (`starts_on` to
`coalesce(ends_on, materialized_through)`, `canceled_at is null`).

This matcher is not new. `DELETE /group-x/series/:id` (`groupX.js:507`) already
does exactly this to find its cancellation targets. It gets **extracted into a
single tested helper** in `auth/src/lib/groupXSeries.js` and used by both, so
there is one definition of "this class belongs to that series" rather than two
that can drift.

Each class carries `series_source: 'linked' | 'inferred' | null`. The modal
shows which, because an inferred link must never silently rewrite forty classes
without saying what it believes it is rewriting. Where a shape matches more than
one live series the result is ambiguous: return no link and offer the occurrence
edit only.

### Backfill

A one-off script runs the same matcher across each club's live series over their
materialized range and inserts the rows it finds. Idempotent — primary key
collision means already linked. Backfill failure is not fatal; unlinked classes
simply fall through to the inference path.

## Component 2: the edit modal

One modal per scheduler, replacing the current read-only popover. Opens with a
scope toggle at the top: **This class** / **All classes from here on**, the
second appearing only when the class has a series.

| Field | Group X | Courts & Pool |
|---|---|---|
| Class / Title | editable — changes length | editable |
| Instructor / Staff | editable | editable |
| Date | editable in *this class* mode | same |
| Repeats on (weekday pills) | editable in *all from here* mode | same |
| Start time | editable | editable |
| Length | read-only, from the class type | editable |
| Training level | editable when the type has >1 | n/a |
| New badge | editable | n/a |

In *this class* mode you pick a date. In *all from here* mode you pick weekdays,
effective from this occurrence forward. Because the rebuild recreates every
future occurrence anyway, moving a series from Tuesday to Wednesday costs
nothing beyond what the save already does.

Footer actions:

- **Cancel this class** — the existing single-occurrence delete.
- **Cancel this and all after** — series only. Maps onto the existing
  `DELETE /series/:id?through=<day before this occurrence>`. The server work is
  already done and tested; it was simply unreachable from the calendar.

Reused as-is from `CreateClassModal`: the weekday pills, the preview/confirm
step, and the partial-failure result panel. This is a variant of that flow, not
a new one.

## Component 3: what save does

### Courts & Pool

*This class* updates one `facility_events` row.

*All from here on* updates the `facility_series` definition, then **replaces**
every future non-cancelled event row belonging to it: the new definition is
re-expanded through the series' `ends_on` (or `materialized_through` when open
ended) and written in place of the old rows. Replacement rather than update,
because changing the weekday set changes which dates exist — a Tuesday series
moved to Wednesday has no Tuesday row to update.

Rows strictly before the edit date are never touched.

Because the dates can change, this previews too. Both schedulers show the same
confirm step for *all from here on*, so there is one mental model rather than a
Group X quirk. The facility side cannot partially fail — it is our own table —
so its result panel reports a count and nothing else.

New endpoints:

- `PUT /facility-schedule/events/:id`
- `PUT /facility-schedule/series/:id/from/:date`

### Group X

A save is delete-then-create, and **create runs first**. The new class is
created and its id confirmed before the old one is cancelled, so a failure
leaves the original class on the calendar rather than a hole in the schedule.
The reverse order risks deleting a class and then failing to recreate it.

After a successful swap, carried from the old id to the new one:

- the `group_x_new_class_events` badge row, if any
- the `group_x_series_events` link row

Attendance is not carried, because editing is restricted to future classes and a
future class has no headcount. If a row somehow exists it is moved with the rest.

Badge carry-over is best-effort and reported, never fatal — the same rule
`POST /classes` already applies, for the same reason: the class exists either
way, and failing the request over a badge would be worse than a missing badge.

*All from here on* previews, confirms, then rebuilds sequentially — not in
parallel. ABC is a rate-limited production API and an ordered failure list is
what a human can act on. The series row is updated to the new shape, and
`invalidatePublicBoard` is called for every affected date or the TV boards serve
the old schedule for up to five minutes per week touched.

New endpoints:

- `PUT /group-x/classes/:eventId`
- `POST /group-x/series/:id/edit-preview`
- `PUT /group-x/series/:id/from/:date`

## Component 4: Monday-anchored grids

`WeekGrid` renders day headers as `WEEKDAY_LABELS[i]` where `i` is the column
index, which hard-wires the grid to a Sunday start. The fix is to label each
column from its own `Date` rather than its position, which is correct for any
anchor.

`GroupXView` and `FacilityView` then anchor to Monday via a new
`startOfWeekMonday` helper. **`startOfWeek` is left alone** — PT Scheduler
shares it and is in production; it does not change as a side effect of this
work.

## Error handling

- ABC's own message is surfaced verbatim. Its `API-CAL-EVT-*` codes are the
  diagnostic and hiding them behind "something went wrong" wastes time.
- Partial failure is stated as partial failure, with the per-date reason:
  `Changed 38 of 41. 3 failed:` followed by the list.
- A rebuild that fails to create never cancels the original.
- An ambiguous inferred series link disables the series scope rather than
  guessing.

## Testing

Pure logic, unit tested, no I/O — matching the existing `groupXSeries.test.js`
and `abcGroupX.test.js`:

- the extracted series matcher: exact match, wrong weekday, wrong time, outside
  date range, cancelled series, open-ended series via `materialized_through`,
  and the ambiguous multi-match case
- occurrence-list expansion for an edit starting mid-series
- `startOfWeekMonday` across a Sunday, a Monday, and a DST boundary
- day-header labelling independent of anchor

Route tests with a mocked ABC service:

- occurrence edit creates before cancelling; a failed create leaves the original
  class alone and returns the ABC error
- badge and series link move to the new event id
- series edit rebuilds only occurrences on or after the given date
- a partially failed rebuild reports counts honestly and does not claim success

Not covered by tests, verified by hand at one club before rollout: the real ABC
round trip. `reference_abc_daterange_needs_span` applies — a same-day read-back
returns zero rows, so widen the range when confirming.

## Shipping order

Four independently mergeable PRs:

1. **Migration 182 + series link** — table, writes at the three sites, extracted
   matcher, `series_id` on `GET /classes`, backfill script. No visible change.
2. **Courts & Pool edit modal** — the half with no ABC constraints. Proves the
   modal shape end to end.
3. **Group X edit modal** — occurrence and series-forward, on top of 1 and 2.
   Removes `SeriesList`.
4. **Monday grids** — small, independent, no dependency on the others.

Migration 182 is applied by hand at merge of PR 1.

## Out of scope

- Editing past classes.
- A length field on Group X. ABC does not permit it, and a display-only override
  would move the lie onto the member booking screen.
- Drag-to-move on the grid. The modal is the first step; dragging can come later
  on top of the same endpoints.
- Copying a whole week. Separate feature, separate design.
