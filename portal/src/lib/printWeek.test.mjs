import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  startOfPrintWeek, buildPrintWeek, isPrintable, printWeekLabel, PRINT_DAY_LABELS,
} from './printWeek.js'

const ev = (over) => ({
  event_id: 'e1',
  class_name: 'Bootcamp',
  instructor_name: 'Matthew Astley',
  event_timestamp_local: '2026-08-03 06:00:00',
  duration_minutes: 60,
  status: 'Pending',
  ...over,
})

test('startOfPrintWeek anchors to Monday, not Sunday like weekGrid', () => {
  // 2026-08-05 is a Wednesday; its print week starts Monday 2026-08-03.
  assert.equal(startOfPrintWeek(new Date(2026, 7, 5)).getDate(), 3)
  // A Monday is its own week start.
  assert.equal(startOfPrintWeek(new Date(2026, 7, 3)).getDate(), 3)
})

test('Sunday belongs to the week that STARTED six days earlier', () => {
  // The off-by-one that would put Sunday's classes on next week's sheet.
  // 2026-08-09 is a Sunday; its Monday is 2026-08-03, not 2026-08-10.
  const m = startOfPrintWeek(new Date(2026, 7, 9))
  assert.equal(m.getMonth(), 7)
  assert.equal(m.getDate(), 3)
})

test('startOfPrintWeek zeroes the time and crosses a month boundary', () => {
  const m = startOfPrintWeek(new Date(2026, 7, 2, 23, 59, 59)) // Sun Aug 2
  assert.equal(m.getHours(), 0)
  assert.equal(m.getMonth(), 6) // July
  assert.equal(m.getDate(), 27)
})

test('the week is always seven days, Monday first, empty days kept', () => {
  const week = buildPrintWeek(new Date(2026, 7, 3), [])
  assert.equal(week.length, 7)
  assert.deepEqual(week.map(d => d.label), PRINT_DAY_LABELS)
  assert.equal(week[0].label, 'Monday')
  assert.equal(week[6].label, 'Sunday')
  assert.equal(week[6].events.length, 0)
})

test('events land on their own weekday', () => {
  const week = buildPrintWeek(new Date(2026, 7, 3), [
    ev({ event_timestamp_local: '2026-08-03 06:00:00' }),               // Mon
    ev({ event_id: 'e2', event_timestamp_local: '2026-08-09 09:30:00' }), // Sun
  ])
  assert.equal(week[0].events.length, 1)
  assert.equal(week[6].events.length, 1)
})

test('an unbooked ABC ghost never prints alongside the real class', () => {
  // Real Salem shape: two 9:30 Barbell Strength rows at the same time, one
  // staffed and one "Unbooked Unbooked". Printing both duplicates the class.
  const week = buildPrintWeek(new Date(2026, 7, 3), [
    ev({ class_name: 'Barbell Strength', event_timestamp_local: '2026-08-03 09:30:00' }),
    ev({
      event_id: 'ghost', class_name: 'Barbell Strength', instructor_name: null,
      unbooked: true, event_timestamp_local: '2026-08-03 09:30:00',
    }),
  ])
  assert.equal(week[0].events.length, 1)
  assert.equal(week[0].events[0].instructor_name, 'Matthew Astley')
})

test('cancelled classes never print', () => {
  for (const status of ['Canceled', 'canceled-charge', 'CANCELLED']) {
    assert.equal(isPrintable(ev({ status })), false, status)
  }
})

test('facility slots with nobody assigned still print', () => {
  // Lap swim has no instructor by design; requiring one prints an empty pool.
  const slot = ev({ class_name: 'Lap Swim', instructor_name: null })
  assert.equal(isPrintable(slot), false)
  assert.equal(isPrintable(slot, { requireInstructor: false }), true)

  const week = buildPrintWeek(new Date(2026, 7, 3), [slot], { requireInstructor: false })
  assert.equal(week[0].events.length, 1)
})

test('a cancelled facility slot stays out even when instructors are optional', () => {
  assert.equal(
    isPrintable(ev({ instructor_name: null, status: 'Canceled' }), { requireInstructor: false }),
    false,
  )
})

test('events outside the chosen week are dropped, not folded into a Monday', () => {
  // The Group X fetch pads its range for the ABC timezone edge, so it returns
  // a little more than the week asked for.
  const week = buildPrintWeek(new Date(2026, 7, 3), [
    ev({ event_timestamp_local: '2026-08-02 06:00:00' }), // the Sunday before
    ev({ event_id: 'e2', event_timestamp_local: '2026-08-10 06:00:00' }), // the Monday after
  ])
  assert.equal(week.reduce((n, d) => n + d.events.length, 0), 0)
})

test('a day is sorted by start time, then by name for a stable reprint', () => {
  const week = buildPrintWeek(new Date(2026, 7, 3), [
    ev({ event_id: 'c', class_name: 'Yoga', event_timestamp_local: '2026-08-03 18:00:00' }),
    ev({ event_id: 'a', class_name: 'Zumba', event_timestamp_local: '2026-08-03 06:00:00' }),
    ev({ event_id: 'b', class_name: 'Bootcamp', event_timestamp_local: '2026-08-03 06:00:00' }),
  ])
  assert.deepEqual(week[0].events.map(e => e.class_name), ['Bootcamp', 'Zumba', 'Yoga'])
})

test('times are rendered 12-hour, and noon and midnight are not "0:00"', () => {
  const week = buildPrintWeek(new Date(2026, 7, 3), [
    ev({ event_id: 'a', event_timestamp_local: '2026-08-03 00:15:00' }),
    ev({ event_id: 'b', event_timestamp_local: '2026-08-03 12:00:00' }),
    ev({ event_id: 'c', event_timestamp_local: '2026-08-03 13:05:00' }),
  ])
  assert.deepEqual(week[0].events.map(e => e.time_label), ['12:15 AM', '12:00 PM', '1:05 PM'])
})

test('both timestamp separators parse', () => {
  // Cached rows use 'T', live ABC rows use a space.
  const week = buildPrintWeek(new Date(2026, 7, 3), [
    ev({ event_id: 'a', event_timestamp_local: '2026-08-03T06:00:00' }),
    ev({ event_id: 'b', event_timestamp_local: '2026-08-03 07:00:00' }),
  ])
  assert.equal(week[0].events.length, 2)
})

test('an unparseable timestamp is dropped rather than crashing the sheet', () => {
  const week = buildPrintWeek(new Date(2026, 7, 3), [ev({ event_timestamp_local: 'nonsense' })])
  assert.equal(week[0].events.length, 0)
})

test('the picker label spans a month boundary', () => {
  assert.equal(printWeekLabel(new Date(2026, 6, 27)), 'Jul 27 - Aug 2, 2026')
  assert.equal(printWeekLabel(new Date(2026, 7, 3)), 'Aug 3 - 9, 2026')
})
