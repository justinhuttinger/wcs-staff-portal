const test = require('node:test')
const assert = require('node:assert')
const { parseExcludedValue, SEED_EXCLUDED_TYPES } = require('./lapsedConfig')

test('parseExcludedValue: array passthrough, trims, drops non-strings', () => {
  assert.deepStrictEqual(parseExcludedValue(['CORP', ' NON-MEMBER ', 5, '']), ['CORP', 'NON-MEMBER'])
})
test('parseExcludedValue: JSON string', () => {
  assert.deepStrictEqual(parseExcludedValue('["CORP","STAFF"]'), ['CORP', 'STAFF'])
})
test('parseExcludedValue: garbage -> []', () => {
  assert.deepStrictEqual(parseExcludedValue(null), [])
  assert.deepStrictEqual(parseExcludedValue('not json'), [])
})
test('SEED_EXCLUDED_TYPES contains the agreed buckets', () => {
  for (const t of ['NON-MEMBER', 'CORP', 'A2 RECIP USE -Active Adult Reciprocal Use', 'GYMPASS - WELLHUB', 'EVENT ACCESS']) {
    assert.ok(SEED_EXCLUDED_TYPES.includes(t), `missing ${t}`)
  }
})
