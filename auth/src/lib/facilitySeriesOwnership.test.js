const test = require('node:test')
const assert = require('node:assert')
const { seriesEditRefused } = require('./facilitySeriesOwnership')

const series = { club_number: '10', facility: 'pool', canceled_at: null }

test('allows the edit when the claimed club and facility match the series', () => {
  assert.strictEqual(seriesEditRefused(series, '10', 'pool'), false)
})

// CRITICAL 2 regression: canUseClub only proves the caller may use the club
// they claimed, not that the series they hold actually belongs to it. A lead
// at club 10 holding club 20's series id must be refused, not silently
// allowed to move club 20's events onto club 10.
test('refuses when the claimed club does not match the series club', () => {
  assert.strictEqual(seriesEditRefused(series, '20', 'pool'), true)
})

test('refuses when the claimed facility does not match the series facility', () => {
  assert.strictEqual(seriesEditRefused(series, '10', 'courts'), true)
})

// Club numbers travel through query strings and JSON bodies inconsistently
// typed (number vs string) -- the comparison must not let a type mismatch
// alone cause a false refusal for a legitimate same-club edit.
test('compares club_number as a string so a numeric body value still matches', () => {
  assert.strictEqual(seriesEditRefused(series, 10, 'pool'), false)
})

test('refuses a missing series', () => {
  assert.strictEqual(seriesEditRefused(null, '10', 'pool'), true)
  assert.strictEqual(seriesEditRefused(undefined, '10', 'pool'), true)
})

// IMPORTANT 5 regression: editing a cancelled series must not silently
// resurrect it.
test('refuses an already-cancelled series even when club and facility match', () => {
  const canceled = { club_number: '10', facility: 'pool', canceled_at: '2026-08-01T00:00:00.000Z' }
  assert.strictEqual(seriesEditRefused(canceled, '10', 'pool'), true)
})
