const test = require('node:test')
const assert = require('node:assert')
const { FACILITIES, facilityBySlug, isKnownFacility } = require('./facilities')

test('FACILITIES covers courts and pool', () => {
  assert.deepStrictEqual(FACILITIES.map(f => f.slug), ['courts', 'pool'])
})

test('facilityBySlug is case insensitive', () => {
  assert.strictEqual(facilityBySlug('COURTS').label, 'Courts')
  assert.strictEqual(facilityBySlug('pool').title, 'Pool Schedule')
})

test('facilityBySlug rejects anything not on the allowlist', () => {
  // The public board is unauthenticated, so an unknown facility must not reach
  // a query.
  assert.strictEqual(facilityBySlug('sauna'), null)
  assert.strictEqual(facilityBySlug(''), null)
  assert.strictEqual(facilityBySlug(undefined), null)
  assert.strictEqual(facilityBySlug("courts'; drop table --"), null)
  assert.strictEqual(isKnownFacility('sauna'), false)
})
