const test = require('node:test')
const assert = require('node:assert')
const { dedupeKey, matchAutomation, buildTillReceiptPayload } = require('./printJobs')

test('dedupeKey is stable and namespaced', () => {
  assert.equal(dedupeKey('till_close', 'Salem', '2026-06-29'), 'till_close:salem:2026-06-29')
})

test('matchAutomation honors enabled flag and ILIKE-ish pattern', () => {
  const a = { enabled: true, job_name_match: '%drawer close%' }
  assert.equal(matchAutomation(a, 'Drawer Close Count (Jun 29)'), true)
  assert.equal(matchAutomation(a, 'AM Open Count'), false)
  assert.equal(matchAutomation({ ...a, enabled: false }, 'Drawer Close Count'), false)
})

test('buildTillReceiptPayload maps reconciliation to template fields', () => {
  const recon = {
    location_slug: 'salem', business_date: '2026-06-29', closed_by: 'Justin H.',
    opening_float: 100, cash_sales: 342.5, cash_refunds: 0, cash_drops: 200,
    expected_close: 242.5, counted_close: 240, over_short: -2.5, bag_drop: 140,
    drops: [{ name: 'Cash Drop', amount: 200 }],
  }
  const p = buildTillReceiptPayload(recon)
  assert.equal(p.type, 'till_close')
  assert.equal(p.location, 'salem')
  assert.equal(p.counted, 240)
  assert.equal(p.overShort, -2.5)
  assert.equal(p.bagDrop, 140)
  assert.deepEqual(p.drops, [{ name: 'Cash Drop', amount: 200 }])
})
