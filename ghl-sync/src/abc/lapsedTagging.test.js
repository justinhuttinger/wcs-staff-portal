const test = require('node:test')
const assert = require('node:assert')
const { daysSince, selectTier, parseAbcPacificDate } = require('./lapsedTagging')

// Fixed "now": 2026-07-14 12:00 PT
const NOW = new Date('2026-07-14T19:00:00Z')

test('daysSince: uses last check-in when present', () => {
  assert.strictEqual(daysSince('2026-07-04T10:00:00', '2026-01-01', NOW), 10)
})
test('daysSince: falls back to join date when no check-in (grace period)', () => {
  assert.strictEqual(daysSince(null, '2026-07-09', NOW), 5)
})
test('daysSince: null when both missing', () => {
  assert.strictEqual(daysSince(null, null, NOW), null)
})
test('selectTier: boundaries', () => {
  assert.strictEqual(selectTier(9), null)
  assert.strictEqual(selectTier(10), 'lapsed-10d')
  assert.strictEqual(selectTier(20), 'lapsed-10d')
  assert.strictEqual(selectTier(21), 'lapsed-21d')
  assert.strictEqual(selectTier(29), 'lapsed-21d')
  assert.strictEqual(selectTier(30), 'lapsed-30d')
  assert.strictEqual(selectTier(365), 'lapsed-30d')
  assert.strictEqual(selectTier(null), null)
})
test('parseAbcPacificDate: handles date-only and null', () => {
  assert.ok(parseAbcPacificDate('2026-07-09') instanceof Date)
  assert.strictEqual(parseAbcPacificDate(null), null)
  assert.strictEqual(parseAbcPacificDate(''), null)
})
