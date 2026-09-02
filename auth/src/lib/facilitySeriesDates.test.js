const test = require('node:test')
const assert = require('node:assert')
const { affectedDates } = require('./facilitySeriesDates')

test('same weekdays: old and new occurrence dates are identical', () => {
  const oldDates = ['2026-09-08', '2026-09-15', '2026-09-22']
  const newDates = ['2026-09-08', '2026-09-15', '2026-09-22']
  assert.deepStrictEqual(affectedDates(oldDates, newDates), oldDates)
})

test('weekday change: old and new dates are disjoint, both sides invalidated', () => {
  // Tuesday series moved to Wednesday -- the headline case this exists for.
  const oldDates = ['2026-09-08', '2026-09-15'] // Tuesdays
  const newDates = ['2026-09-09', '2026-09-16'] // Wednesdays
  assert.deepStrictEqual(
    affectedDates(oldDates, newDates),
    ['2026-09-08', '2026-09-09', '2026-09-15', '2026-09-16'],
  )
})

test('partial overlap: shared dates are not duplicated', () => {
  const oldDates = ['2026-09-08', '2026-09-15', '2026-09-22']
  const newDates = ['2026-09-15', '2026-09-22', '2026-09-29']
  assert.deepStrictEqual(
    affectedDates(oldDates, newDates),
    ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'],
  )
})

test('empty inputs are handled without throwing', () => {
  assert.deepStrictEqual(affectedDates([], []), [])
  assert.deepStrictEqual(affectedDates(undefined, ['2026-09-08']), ['2026-09-08'])
})
