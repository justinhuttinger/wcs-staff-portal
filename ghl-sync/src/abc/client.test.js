const test = require('node:test')
const assert = require('node:assert')
const { transformABCMember } = require('./client')

test('transformABCMember keeps the home address', () => {
  const row = transformABCMember({
    memberId: 'm1',
    personal: {
      firstName: 'Ann', addressLine1: '290 Moyer Ln NW', addressLine2: 'Apt 4',
      city: 'Salem', state: 'OR', postalCode: '97304',
    },
  }, '30935')
  assert.strictEqual(row.address_line1, '290 Moyer Ln NW')
  assert.strictEqual(row.address_line2, 'Apt 4')
  assert.strictEqual(row.city, 'Salem')
  assert.strictEqual(row.state, 'OR')
  assert.strictEqual(row.postal_code, '97304')
  // Generated in Postgres; sending it would fail the upsert.
  assert.ok(!('address_key' in row))
})

test('transformABCMember nulls a missing address', () => {
  const row = transformABCMember({ memberId: 'm2', personal: {} }, '30935')
  assert.strictEqual(row.address_line1, null)
  assert.strictEqual(row.postal_code, null)
})
