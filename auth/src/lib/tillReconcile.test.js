// auth/src/lib/tillReconcile.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { reconcileDay } = require('./tillReconcile')

test('balanced day', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: 100, closingCount: 250,
    cashSales: 160, cashRefunds: 10, cashDrops: 0 })
  assert.equal(r.expectedClose, 250)      // 100 + 160 - 10 - 0
  assert.equal(r.overShort, 0)            // 250 - 250
  assert.equal(r.bagDrop, 150)            // 250 - 100 par
  assert.equal(r.floatVariance, 0)        // opening 100 vs par 100
  assert.equal(r.status, 'complete')
})
test('short drawer', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: 100, closingCount: 230,
    cashSales: 160, cashRefunds: 10, cashDrops: 0 })
  assert.equal(r.overShort, -20)          // 230 - 250
})
test('drop accounted for', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: 100, closingCount: 100,
    cashSales: 160, cashRefunds: 0, cashDrops: 160 })
  assert.equal(r.expectedClose, 100)
  assert.equal(r.overShort, 0)
  assert.equal(r.bagDrop, 0)
})
test('opening float drift flagged', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: 80, closingCount: 240,
    cashSales: 160, cashRefunds: 0, cashDrops: 0 })
  assert.equal(r.floatVariance, -20)      // someone left 80 not 100
  assert.equal(r.expectedClose, 240)      // uses actual opening 80
  assert.equal(r.overShort, 0)
})
test('missing close', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: 100, closingCount: null,
    cashSales: 50, cashRefunds: 0, cashDrops: 0 })
  assert.equal(r.countedClose, null)
  assert.equal(r.overShort, null)
  assert.equal(r.status, 'missing_close')
})
test('missing open falls back to par', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: null, closingCount: 260,
    cashSales: 160, cashRefunds: 0, cashDrops: 0 })
  assert.equal(r.openingFloat, 100)       // assume par when not counted
  assert.equal(r.floatVariance, null)     // unknown
  assert.equal(r.overShort, 0)
  assert.equal(r.status, 'missing_open')
})
