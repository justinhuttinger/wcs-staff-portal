const test = require('node:test')
const assert = require('node:assert')
const { clubNumberForLocationName } = require('./clubMap')

test('maps location names (case-insensitive) to club numbers', () => {
  assert.equal(clubNumberForLocationName('Salem'), '30935')
  assert.equal(clubNumberForLocationName('medford'), '32073')
  assert.equal(clubNumberForLocationName('  Eugene '), '7655')
})

test('returns null for unknown names', () => {
  assert.equal(clubNumberForLocationName('Portland'), null)
  assert.equal(clubNumberForLocationName(''), null)
  assert.equal(clubNumberForLocationName(null), null)
})
