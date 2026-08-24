const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeExternalId, matchCoverage } = require('./metaMatch')

test('normalizeExternalId trims and lowercases so both halves hash alike', () => {
  assert.equal(
    normalizeExternalId('  8F3A2B1C-4D5E-6F70-8192-A3B4C5D6E7F8 '),
    '8f3a2b1c-4d5e-6f70-8192-a3b4c5d6e7f8'
  )
})

test('normalizeExternalId leaves an already-normal uuid untouched', () => {
  const id = '8f3a2b1c-4d5e-6f70-8192-a3b4c5d6e7f8'
  assert.equal(normalizeExternalId(id), id)
})

test('normalizeExternalId returns empty for anything unusable', () => {
  assert.equal(normalizeExternalId(null), '')
  assert.equal(normalizeExternalId(undefined), '')
  assert.equal(normalizeExternalId(''), '')
  assert.equal(normalizeExternalId('   '), '')
  // Objects would stringify to "[object Object]" and hash to a digest shared
  // by every caller that sent one — worse than sending nothing.
  assert.equal(normalizeExternalId({}), '')
  assert.equal(normalizeExternalId([]), '')
})

test('matchCoverage reports presence for every key, in a fixed order', () => {
  assert.equal(
    matchCoverage({}),
    'em=n ph=n fn=n ln=n fbp=n fbc=n xid=n ip=n ua=n'
  )
})

test('matchCoverage flags the keys that carry a value', () => {
  const userData = {
    em: ['abc'],
    ph: ['def'],
    fbp: 'fb.1.123.456',
    external_id: ['ghi'],
    client_ip_address: '203.0.113.4',
  }
  assert.equal(
    matchCoverage(userData),
    'em=y ph=y fn=n ln=n fbp=y fbc=n xid=y ip=y ua=n'
  )
})

test('matchCoverage never logs a value, only y/n', () => {
  const line = matchCoverage({ em: ['deadbeef'], fbp: 'fb.1.999.secret' })
  assert.ok(!line.includes('deadbeef'))
  assert.ok(!line.includes('secret'))
})

test('matchCoverage tolerates a missing user_data object', () => {
  assert.equal(
    matchCoverage(undefined),
    'em=n ph=n fn=n ln=n fbp=n fbc=n xid=n ip=n ua=n'
  )
})
