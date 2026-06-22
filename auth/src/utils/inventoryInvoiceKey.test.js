const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeOrderNumber } = require('./inventoryInvoiceKey')

test('normalizeOrderNumber: trims, uppercases, collapses whitespace', () => {
  assert.equal(normalizeOrderNumber('  po 12 345 '), 'PO 12 345')
  assert.equal(normalizeOrderNumber('inv-0099'), 'INV-0099')
})

test('normalizeOrderNumber: strips surrounding punctuation', () => {
  assert.equal(normalizeOrderNumber('#A1009.'), 'A1009')
})

test('normalizeOrderNumber: empty/nullish -> null', () => {
  for (const v of [null, undefined, '', '   ', '#']) assert.equal(normalizeOrderNumber(v), null)
})

