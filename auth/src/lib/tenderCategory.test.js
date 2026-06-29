// auth/src/lib/tenderCategory.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { tenderCategory } = require('./tenderCategory')

test('cash', () => assert.equal(tenderCategory('Cash'), 'cash'))
test('plain card brands', () => {
  assert.equal(tenderCategory('Visa'), 'card')
  assert.equal(tenderCategory('Master Card'), 'card')
  assert.equal(tenderCategory('American Express'), 'card')
})
test('masked card brands', () => {
  assert.equal(tenderCategory('Visa(xxxx6263)'), 'card')
  assert.equal(tenderCategory('Master Card(xxxx0508)'), 'card')
})
test('check / account / writeoff', () => {
  assert.equal(tenderCategory('Check'), 'check')
  assert.equal(tenderCategory('Club Account'), 'account')
  assert.equal(tenderCategory('Write Off'), 'writeoff')
})
test('unknown / empty -> other', () => {
  assert.equal(tenderCategory('Apple Pay'), 'other')
  assert.equal(tenderCategory(''), 'other')
  assert.equal(tenderCategory(null), 'other')
})
