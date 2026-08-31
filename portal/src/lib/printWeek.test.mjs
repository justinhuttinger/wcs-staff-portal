import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startOfPrintWeek, printWeekLabel } from './printWeek.js'

// Both boards print themselves now, so all this file still owes the print
// picker is the Monday anchor and the label for it.

test('startOfPrintWeek anchors to Monday', () => {
  // Thursday
  assert.equal(startOfPrintWeek(new Date('2026-09-03T12:00:00')).getDay(), 1)
  // Monday stays put
  const mon = startOfPrintWeek(new Date('2026-08-31T12:00:00'))
  assert.equal(mon.getDay(), 1)
  assert.equal(mon.getDate(), 31)
})

test('startOfPrintWeek walks Sunday BACK six days, not forward one', () => {
  // The trap: getDay() is 0 for Sunday, so the naive `- dow` leaves it alone
  // and Sunday's classes land on next week's sheet.
  const sun = startOfPrintWeek(new Date('2026-09-06T12:00:00'))
  assert.equal(sun.getDay(), 1)
  assert.equal(sun.getDate(), 31)
  assert.equal(sun.getMonth(), 7) // August
})

test('startOfPrintWeek does not mutate its argument', () => {
  const d = new Date('2026-09-03T12:00:00')
  startOfPrintWeek(d)
  assert.equal(d.getDate(), 3)
})

test('printWeekLabel spans a month boundary', () => {
  assert.equal(printWeekLabel(new Date('2026-08-31T00:00:00')), 'Aug 31 - Sep 6, 2026')
  assert.equal(printWeekLabel(new Date('2026-09-07T00:00:00')), 'Sep 7 - 13, 2026')
})
