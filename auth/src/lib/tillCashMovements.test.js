// auth/src/lib/tillCashMovements.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { classifyCashLine } = require('./tillCashMovements')

const DROP = 'XXXCASHDROPXXX'
test('cash sale', () => {
  assert.deepEqual(classifyCashLine({ tender_category: 'cash', is_return: false, upc: '810113510286', amount: 5 }, DROP),
    { sales: 5, refunds: 0, drops: 0 })
})
test('cash refund', () => {
  assert.deepEqual(classifyCashLine({ tender_category: 'cash', is_return: true, upc: '810113510286', amount: 5 }, DROP),
    { sales: 0, refunds: 5, drops: 0 })
})
test('cash drop item (matched by UPC sentinel)', () => {
  assert.deepEqual(classifyCashLine({ tender_category: 'cash', is_return: false, upc: 'XXXCASHDROPXXX', amount: 200 }, DROP),
    { sales: 0, refunds: 0, drops: 200 })
})
test('card sale ignored', () => {
  assert.deepEqual(classifyCashLine({ tender_category: 'card', is_return: false, upc: '810113510286', amount: 5 }, DROP),
    { sales: 0, refunds: 0, drops: 0 })
})
