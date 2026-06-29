// auth/src/lib/posPayments.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { extractItemPayments } = require('./posPayments')

test('array of payments', () => {
  const out = extractItemPayments({ payments: [
    { paymentType: 'Cash', paymentAmount: '2.62', paymentTax: '0.00' },
    { paymentType: 'Visa(xxxx6263)', paymentAmount: '10.00', paymentTax: '0.50' },
  ]})
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], { payment_type: 'Cash', payment_amount: 2.62, payment_tax: 0, tender_category: 'cash' })
  assert.equal(out[1].tender_category, 'card')
})
test('single payment as object', () => {
  const out = extractItemPayments({ payments: { paymentType: 'Cash', paymentAmount: '5.00' } })
  assert.equal(out.length, 1)
  assert.equal(out[0].payment_amount, 5)
})
test('no payments key', () => assert.deepEqual(extractItemPayments({}), []))
