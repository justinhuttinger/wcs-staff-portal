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
const event = { job_name: 'Drawer Close Count (Jun 29)', location_slug: 'salem', job_date: '2026-06-29', submitted_by: 'Sam' }

test('enqueues when automation enabled + device enabled + recon present', async () => {
  const insertSink = []
  const supabase = fakeSupabase({
    automation: { enabled: true, job_name_match: '%drawer close%', print_type: 'till_close' },
    device: { install_id: 'abc', selected_printer: 'Star', enabled: true },
    insertSink,
  })
  const res = await maybeEnqueueTillReceipt({
    supabase, event, loadReconciliation: async () => recon,
  })
  assert.equal(res.enqueued, true)
  assert.equal(res.jobId, 'job-1')
  assert.equal(insertSink.length, 1)
  assert.equal(insertSink[0].type, 'till_close')
  assert.equal(insertSink[0].dedupe_key, 'till_close:salem:2026-06-29')
  assert.equal(insertSink[0].install_id, 'abc')
})

test('skips when no enabled automation matches', async () => {
  const supabase = fakeSupabase({ automation: null, device: { enabled: true }, insertSink: [] })
  const res = await maybeEnqueueTillReceipt({ supabase, event, loadReconciliation: async () => recon })
  assert.equal(res.enqueued, false)
  assert.equal(res.reason, 'no_automation')
})

test('skips when no enabled device for the location', async () => {
  const supabase = fakeSupabase({
    automation: { enabled: true, job_name_match: '%drawer close%', print_type: 'till_close' },
    device: null, insertSink: [],
  })
  const res = await maybeEnqueueTillReceipt({ supabase, event, loadReconciliation: async () => recon })
  assert.equal(res.enqueued, false)
  assert.equal(res.reason, 'no_device')
})
