const test = require('node:test')
const assert = require('node:assert')
const { maybeEnqueueTillReceipt } = require('./tillReceipt')

// Minimal fake supabase tuned to the exact calls the service makes.
function fakeSupabase({ automation, device, insertSink }) {
  return {
    from(table) {
      if (table === 'print_automations') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: automation, error: null }) }) }) }
      }
      if (table === 'print_devices') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: device, error: null }) }) }) }) }
      }
      if (table === 'print_jobs') {
        return { insert: (rows) => ({ select: () => ({ maybeSingle: async () => {
          insertSink.push(rows); return { data: { id: 'job-1' }, error: null }
        } }) }) }
      }
      throw new Error('unexpected table ' + table)
    },
  }
}

const recon = {
  location_slug: 'salem', business_date: '2026-06-29', closed_by: 'Sam',
  opening_float: 100, cash_sales: 300, cash_refunds: 0, cash_drops: 0,
  expected_close: 400, counted_close: 400, over_short: 0, bag_drop: 300, drops: [],
}
const args = { locationSlug: 'salem', businessDate: '2026-06-29' }

test('enqueues when automation enabled + device enabled + recon present', async () => {
  const insertSink = []
  const supabase = fakeSupabase({
    automation: { enabled: true },
    device: { install_id: 'abc', selected_printer: 'Star', enabled: true },
    insertSink,
  })
  const res = await maybeEnqueueTillReceipt({ supabase, ...args, loadReconciliation: async () => recon })
  assert.equal(res.enqueued, true)
  assert.equal(res.jobId, 'job-1')
  assert.equal(insertSink.length, 1)
  assert.equal(insertSink[0].type, 'till_close')
  assert.equal(insertSink[0].dedupe_key, 'till_close:salem:2026-06-29')
  assert.equal(insertSink[0].install_id, 'abc')
})

test('skips when automation is missing or disabled', async () => {
  const off = fakeSupabase({ automation: { enabled: false }, device: { enabled: true }, insertSink: [] })
  assert.equal((await maybeEnqueueTillReceipt({ supabase: off, ...args, loadReconciliation: async () => recon })).reason, 'no_automation')
  const none = fakeSupabase({ automation: null, device: { enabled: true }, insertSink: [] })
  assert.equal((await maybeEnqueueTillReceipt({ supabase: none, ...args, loadReconciliation: async () => recon })).reason, 'no_automation')
})

test('skips when no enabled device for the location', async () => {
  const supabase = fakeSupabase({ automation: { enabled: true }, device: null, insertSink: [] })
  const res = await maybeEnqueueTillReceipt({ supabase, ...args, loadReconciliation: async () => recon })
  assert.equal(res.enqueued, false)
  assert.equal(res.reason, 'no_device')
})

test('skips when no reconciliation (no close count yet)', async () => {
  const supabase = fakeSupabase({
    automation: { enabled: true },
    device: { install_id: 'abc', selected_printer: 'Star', enabled: true },
    insertSink: [],
  })
  const res = await maybeEnqueueTillReceipt({ supabase, ...args, loadReconciliation: async () => null })
  assert.equal(res.enqueued, false)
  assert.equal(res.reason, 'no_reconciliation')
})
