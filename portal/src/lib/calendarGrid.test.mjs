import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gridFor, shiftDay, stepMonth, monthRange, monthKey } from './calendarGrid.js'

test('a month grid starts on the Monday on or before the 1st', () => {
  // 2026-09-01 is a Tuesday, so the grid opens on Monday the 31st of August.
  assert.equal(gridFor('2026-09')[0].key, '2026-08-31')
})

test('a month starting on a Sunday steps back six days, not one', () => {
  // 2026-11-01 is a Sunday. Treating it as the start of a week would push the
  // whole month one row up and lose the last day.
  const cells = gridFor('2026-11')
  assert.equal(cells[0].key, '2026-10-26')
  assert.ok(cells.some(c => c.key === '2026-11-30'), 'the last day must be on the grid')
})

test('a month starting on a Monday needs no padding at the front', () => {
  // 2026-06-01 is a Monday.
  assert.equal(gridFor('2026-06')[0].key, '2026-06-01')
})

test('every grid is whole weeks', () => {
  for (const month of ['2026-01', '2026-02', '2026-06', '2026-09', '2026-11', '2027-02']) {
    assert.equal(gridFor(month).length % 7, 0, `${month} is not whole weeks`)
  }
})

test('every day of the month is on its grid exactly once', () => {
  for (const month of ['2026-02', '2026-09', '2026-11', '2028-02']) {
    const cells = gridFor(month).filter(c => c.inMonth).map(c => c.key)
    assert.equal(new Set(cells).size, cells.length, `${month} repeats a day`)
    const { from, to } = monthRange(month)
    assert.equal(cells[0], from)
    assert.equal(cells[cells.length - 1], to)
  }
})

test('a leap February is handled', () => {
  const { to } = monthRange('2028-02')
  assert.equal(to, '2028-02-29')
})

test('stepping months crosses a year boundary', () => {
  assert.equal(stepMonth('2026-12', 1), '2027-01')
  assert.equal(stepMonth('2026-01', -1), '2025-12')
})

test('shiftDay crosses month and year boundaries', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftDay('2027-01-01', -1), '2026-12-31')
})

test('monthKey is the first seven characters and nothing clever', () => {
  assert.equal(monthKey('2026-09-30'), '2026-09')
})
