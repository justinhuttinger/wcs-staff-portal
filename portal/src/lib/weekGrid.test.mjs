import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  startOfWeek, addDays, toISODate, fmtHour, fmtTime12, parseLocalTimestamp, layoutLanes,
  DAY_START_HOUR, DAY_END_HOUR, GRID_HEIGHT_PX,
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
