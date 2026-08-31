import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  startOfWeek, addDays, toISODate, fmtHour, fmtTime12, parseLocalTimestamp, layoutLanes,
  DAY_START_HOUR, DAY_END_HOUR, GRID_HEIGHT_PX, displayClassName, durationLabel, dayWindow,
} from './weekGrid.js'

test('startOfWeek anchors to Sunday', () => {
  // 2026-07-30 is a Thursday; its week starts Sunday 2026-07-26.
  assert.equal(toISODate(startOfWeek(new Date(2026, 6, 30))), '2026-07-26')
  // A Sunday is its own week start.
  assert.equal(toISODate(startOfWeek(new Date(2026, 6, 26))), '2026-07-26')
})

test('startOfWeek zeroes the time so week comparisons are stable', () => {
  const s = startOfWeek(new Date(2026, 6, 30, 23, 59, 59))
  assert.equal(s.getHours(), 0)
  assert.equal(s.getMinutes(), 0)
})

test('addDays crosses month and year boundaries', () => {
  assert.equal(toISODate(addDays(new Date(2026, 6, 31), 1)), '2026-08-01')
  assert.equal(toISODate(addDays(new Date(2026, 11, 31), 1)), '2027-01-01')
  assert.equal(toISODate(addDays(new Date(2026, 0, 1), -1)), '2025-12-31')
})

test('toISODate uses local date parts, not UTC', () => {
  // Late-evening local time must not roll forward a day.
  assert.equal(toISODate(new Date(2026, 6, 28, 23, 30)), '2026-07-28')
})

test('fmtHour renders 12-hour labels', () => {
  assert.equal(fmtHour(6), '6 AM')
  assert.equal(fmtHour(12), '12 PM')
  assert.equal(fmtHour(13), '1 PM')
  assert.equal(fmtHour(0), '12 AM')
})

test('fmtTime12 pads minutes', () => {
  assert.equal(fmtTime12(6, 0), '6:00 AM')
  assert.equal(fmtTime12(18, 5), '6:05 PM')
  assert.equal(fmtTime12(12, 30), '12:30 PM')
})

test('parseLocalTimestamp accepts both the T and space separators', () => {
  // ghl-sync cached rows use 'T'; live ABC rows use a space. Dropping either
  // silently empties the day buckets.
  assert.deepEqual(parseLocalTimestamp('2026-07-28 06:00:00'), { date: '2026-07-28', hour: 6, min: 0 })
  assert.deepEqual(parseLocalTimestamp('2026-07-28T18:30:00'), { date: '2026-07-28', hour: 18, min: 30 })
})

test('parseLocalTimestamp returns null for empty or malformed input', () => {
  assert.equal(parseLocalTimestamp(null), null)
  assert.equal(parseLocalTimestamp(''), null)
  assert.equal(parseLocalTimestamp('07/28/2026 6:00'), null)
})

test('layoutLanes puts non-overlapping events in one lane', () => {
  const events = [{ _startMin: 0, _endMin: 60 }, { _startMin: 60, _endMin: 120 }]
  const out = layoutLanes(events)
  assert.deepEqual(out.map(e => e._laneIndex), [0, 0])
  assert.deepEqual(out.map(e => e._laneCount), [1, 1])
})

test('layoutLanes splits two overlapping events into two lanes', () => {
  const events = [{ _startMin: 0, _endMin: 60 }, { _startMin: 30, _endMin: 90 }]
  const out = layoutLanes(events)
  assert.deepEqual(out.map(e => e._laneIndex), [0, 1])
  assert.deepEqual(out.map(e => e._laneCount), [2, 2])
})

test('layoutLanes sorts by start time regardless of input order', () => {
  const out = layoutLanes([{ _startMin: 120, _endMin: 180 }, { _startMin: 0, _endMin: 60 }])
  assert.deepEqual(out.map(e => e._startMin), [0, 120])
})

test('layoutLanes handles an empty day', () => {
  assert.deepEqual(layoutLanes([]), [])
})

test('grid config covers 6 AM to 10 PM', () => {
  assert.equal(DAY_START_HOUR, 6)
  assert.equal(DAY_END_HOUR, 22)
  assert.equal(GRID_HEIGHT_PX, 960)
})

test('displayClassName drops a length suffix that matches the duration', () => {
  assert.equal(displayClassName('Butts and Guts - 30', 30), 'Butts and Guts')
  assert.equal(displayClassName('Butts and Guts - 60', 60), 'Butts and Guts')
  assert.equal(displayClassName('Butts and Guts-30', 30), 'Butts and Guts')
  assert.equal(displayClassName('Butts and Guts  -  30', 30), 'Butts and Guts')
})

test('displayClassName keeps a number that is not the class length', () => {
  // A real class name that merely ends in a number must survive untouched.
  assert.equal(displayClassName('Zone 2', 60), 'Zone 2')
  assert.equal(displayClassName('Studio - 60', 30), 'Studio - 60')
  assert.equal(displayClassName('Bootcamp', 60), 'Bootcamp')
})

test('displayClassName is safe on missing input', () => {
  assert.equal(displayClassName(null, 30), '')
  assert.equal(displayClassName(undefined, undefined), '')
  // No duration to compare against: trust the suffix and strip it.
  assert.equal(displayClassName('Butts and Guts - 30', null), 'Butts and Guts')
})

test('durationLabel speaks up only for non-standard lengths', () => {
  assert.equal(durationLabel(30), '30 min')
  assert.equal(durationLabel(45), '45 min')
  assert.equal(durationLabel(60), null, '60 is the norm and needs no pill')
  assert.equal(durationLabel(null), null)
  assert.equal(durationLabel(0), null)
  assert.equal(durationLabel('30'), '30 min')
})

// --- dayWindow -------------------------------------------------------------
// The defaults are a floor, not a cap: a class outside 6am-10pm used to be
// positioned at a negative offset and clipped away entirely.

test('dayWindow keeps the default window for an ordinary week', () => {
  const w = dayWindow([{ event_timestamp_local: '2026-09-01 09:00', duration_minutes: 60 }])
  assert.equal(w.startHour, 6)
  assert.equal(w.endHour, 22)
})

test('dayWindow grows down for a 5am class', () => {
  const w = dayWindow([{ event_timestamp_local: '2026-09-01 05:00', duration_minutes: 60 }])
  assert.equal(w.startHour, 5)
  assert.equal(w.endHour, 22)
})

test('dayWindow floors a part-hour start', () => {
  const w = dayWindow([{ event_timestamp_local: '2026-09-01 05:30', duration_minutes: 60 }])
  assert.equal(w.startHour, 5)
})

test('dayWindow grows up for a class running past the end', () => {
  const w = dayWindow([{ event_timestamp_local: '2026-09-01 21:30', duration_minutes: 90 }])
  assert.equal(w.endHour, 23)
})

test('dayWindow treats a missing duration as an hour', () => {
  const w = dayWindow([{ event_timestamp_local: '2026-09-01 22:30' }])
  assert.equal(w.endHour, 24)
})

test('dayWindow never runs past midnight', () => {
  const w = dayWindow([{ event_timestamp_local: '2026-09-01 23:30', duration_minutes: 120 }])
  assert.equal(w.endHour, 24)
})

test('dayWindow ignores unparseable rows and empty input', () => {
  assert.deepEqual(dayWindow([{ event_timestamp_local: 'nonsense' }]), { startHour: 6, endHour: 22 })
  assert.deepEqual(dayWindow([]), { startHour: 6, endHour: 22 })
  assert.deepEqual(dayWindow(undefined), { startHour: 6, endHour: 22 })
})
