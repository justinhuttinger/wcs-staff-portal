const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMoney, parseDate } = require('../src/services/revenueCsvParser')

test('parseMoney handles plain dollars', () => {
  assert.equal(parseMoney('$24.50'), 24.5)
})

test('parseMoney handles commas', () => {
  assert.equal(parseMoney('$1,234.56'), 1234.56)
})

test('parseMoney handles quoted commas', () => {
  assert.equal(parseMoney('"$262,386.78"'), 262386.78)
})

test('parseMoney handles parens as negative (refund)', () => {
  assert.equal(parseMoney('($40.00)'), -40)
})

test('parseMoney handles empty/blank as 0', () => {
  assert.equal(parseMoney(''), 0)
  assert.equal(parseMoney(null), 0)
  assert.equal(parseMoney(undefined), 0)
})

test('parseMoney handles zero', () => {
  assert.equal(parseMoney('$0.00'), 0)
})

test('parseDate converts MM/DD/YYYY to ISO', () => {
  assert.equal(parseDate('05/12/2026'), '2026-05-12')
})

test('parseDate handles single-digit-via-leading-zero MM/DD', () => {
  assert.equal(parseDate('01/05/2024'), '2024-01-05')
})

test('parseDate returns null for blank/invalid', () => {
  assert.equal(parseDate(''), null)
  assert.equal(parseDate(null), null)
  assert.equal(parseDate('garbage'), null)
})
