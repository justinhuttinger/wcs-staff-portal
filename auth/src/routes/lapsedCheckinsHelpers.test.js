const { test } = require('node:test')
const assert = require('node:assert')
const {
  resolveActivityDate,
  daysSinceForMember,
  bucketTier,
  tierDayRange,
  inTierRange,
  normalizeExcludedInput,
  findUnknownTypes,
} = require('./lapsedCheckinsHelpers')

// node:test + node:assert, CommonJS. Run with `node --test`.

// Fixed "now": 2026-07-14 12:00 PT
const NOW = new Date('2026-07-14T19:00:00Z')

test('resolveActivityDate: skips blank/empty-string fields, not just null/undefined', () => {
  assert.strictEqual(
    resolveActivityDate({ last_check_in_timestamp: '', sign_date: '', begin_date: '2026-06-01', since_date: '2020-01-01' }),
    '2026-06-01',
  )
  assert.strictEqual(
    resolveActivityDate({ last_check_in_timestamp: '   ', sign_date: '  ', begin_date: '  ', since_date: '2026-05-01' }),
    '2026-05-01',
  )
})

test('resolveActivityDate: prefers last_check_in_timestamp, falls back in order', () => {
  assert.strictEqual(
    resolveActivityDate({ last_check_in_timestamp: '2026-07-04T10:00:00', sign_date: '2026-01-01' }),
    '2026-07-04',
  )
  assert.strictEqual(
    resolveActivityDate({ last_check_in_timestamp: null, sign_date: '2026-07-09' }),
    '2026-07-09',
  )
  assert.strictEqual(
    resolveActivityDate({ last_check_in_timestamp: '', sign_date: null, begin_date: '2026-06-01' }),
    '2026-06-01',
  )
  assert.strictEqual(
    resolveActivityDate({ last_check_in_timestamp: null, sign_date: null, begin_date: null, since_date: '2026-05-01' }),
    '2026-05-01',
  )
  assert.strictEqual(resolveActivityDate({}), null)
})

test('daysSinceForMember: matches expected day counts', () => {
  assert.strictEqual(
    daysSinceForMember({ last_check_in_timestamp: '2026-07-04T10:00:00' }, NOW),
    10,
  )
  assert.strictEqual(
    daysSinceForMember({ last_check_in_timestamp: null, sign_date: '2026-07-09' }, NOW),
    5,
  )
  assert.strictEqual(daysSinceForMember({}, NOW), null)
})

test('bucketTier: boundaries', () => {
  assert.strictEqual(bucketTier(9), null)
  assert.strictEqual(bucketTier(10), 'tier10')
  assert.strictEqual(bucketTier(20), 'tier10')
  assert.strictEqual(bucketTier(21), 'tier21')
  assert.strictEqual(bucketTier(29), 'tier21')
  assert.strictEqual(bucketTier(30), 'tier30')
  assert.strictEqual(bucketTier(365), 'tier30')
  assert.strictEqual(bucketTier(null), null)
})

test('tierDayRange: valid + invalid params', () => {
  assert.deepStrictEqual(tierDayRange('10'), { min: 10, max: 20 })
  assert.deepStrictEqual(tierDayRange('21'), { min: 21, max: 29 })
  assert.deepStrictEqual(tierDayRange('30'), { min: 30, max: null })
  assert.strictEqual(tierDayRange('99'), null)
  assert.strictEqual(tierDayRange('abc'), null)
})

test('inTierRange: bounds check for each tier', () => {
  assert.strictEqual(inTierRange(20, tierDayRange('10')), true)
  assert.strictEqual(inTierRange(21, tierDayRange('10')), false)
  assert.strictEqual(inTierRange(30, tierDayRange('30')), true)
  assert.strictEqual(inTierRange(9999, tierDayRange('30')), true)
  assert.strictEqual(inTierRange(null, tierDayRange('10')), false)
})

test('normalizeExcludedInput: happy path trims + dedupes', () => {
  const r = normalizeExcludedInput(['CORP', ' NON-MEMBER ', 'CORP', '  '])
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.list, ['CORP', 'NON-MEMBER'])
})

test('normalizeExcludedInput: rejects non-array', () => {
  const r = normalizeExcludedInput('CORP')
  assert.strictEqual(r.ok, false)
})

test('normalizeExcludedInput: rejects non-string entries', () => {
  const r = normalizeExcludedInput(['CORP', 5])
  assert.strictEqual(r.ok, false)
})

test('findUnknownTypes: all entries known -> ok true, empty unknown list', () => {
  const known = new Set(['CORP', 'SINGLE', 'COUPLE'])
  const r = findUnknownTypes(['CORP', 'SINGLE'], known)
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.unknown, [])
})

test('findUnknownTypes: unknown entries rejected and listed', () => {
  const known = new Set(['CORP', 'SINGLE'])
  const r = findUnknownTypes(['CORP', 'NOT-REAL', 'ALSO-FAKE'], known)
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.unknown, ['NOT-REAL', 'ALSO-FAKE'])
})

test('findUnknownTypes: accepts a plain array as the known set; preserves the caller-deduped input order/shape (does not dedupe itself)', () => {
  const r = findUnknownTypes(['SINGLE', 'FAKE'], ['CORP', 'SINGLE'])
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.unknown, ['FAKE'])
})
