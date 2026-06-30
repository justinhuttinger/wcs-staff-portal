const test = require('node:test')
const assert = require('node:assert')
const { toReconRow } = require('./loadReconciliation')
const { buildTillReceiptPayload } = require('./printJobs')

const rec = {
  openingFloat: 100, expectedClose: 242.5, countedClose: 240,
  overShort: -2.5, bagDrop: 140, floatVariance: 0, status: 'complete',
}

test('toReconRow maps reconcileDay output to the snake_case recon shape', () => {
  const row = toReconRow({
    slug: 'salem', businessDate: '2026-06-29', rec, closeBy: 'Sam',
    cashSales: 342.5, cashRefunds: 0, cashDrops: 200,
    dropItems: [{ name: 'Cash drop', amount: 200 }],
  })
  assert.equal(row.location_slug, 'salem')
  assert.equal(row.closed_by, 'Sam')
  assert.equal(row.opening_float, 100)
  assert.equal(row.expected_close, 242.5)
  assert.equal(row.counted_close, 240)
  assert.equal(row.over_short, -2.5)
  assert.equal(row.bag_drop, 140)
  assert.deepEqual(row.drops, [{ name: 'Cash drop', amount: 200 }])
})

test('toReconRow returns null when there is no close count', () => {
  const row = toReconRow({ slug: 'salem', businessDate: '2026-06-29', rec: { ...rec, countedClose: null }, closeBy: '' })
  assert.equal(row, null)
})

test('toReconRow output feeds buildTillReceiptPayload end-to-end', () => {
  const row = toReconRow({
    slug: 'salem', businessDate: '2026-06-29', rec, closeBy: 'Sam',
    cashSales: 342.5, cashRefunds: 0, cashDrops: 200, dropItems: [],
  })
  const payload = buildTillReceiptPayload(row)
  assert.equal(payload.type, 'till_close')
  assert.equal(payload.counted, 240)
  assert.equal(payload.bagDrop, 140)
})
