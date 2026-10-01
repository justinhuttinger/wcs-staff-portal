const test = require('node:test')
const assert = require('node:assert/strict')
const { isSessionEvent, summarizePt, desiredPtFields, ptFieldUpdates, PT_FIELD_KEYS } = require('./ptFields')

const TODAY = '2026-10-01'
const recurring = (extra = {}) => ({
  recurring_type_desc: 'Fixed Interval', status: 'active', service_item: 'PT60',
  unit_price: '87.5', invoice_total: '350', frequency: 'Monthly', number_billed: 2, total_periods: 5,
  sale_date: '2026-08-01', next_billing_date: '2026-10-25', inactive_date: null,
  trainer_name: 'Amber Sarno', sales_person_name: 'Tom Anderson', ...extra,
})
const pif = (extra = {}) => ({
  recurring_type_desc: 'Paid in Full', status: 'inactive', service_item: 'PT60',
  unit_price: '70', invoice_total: '700', frequency: 'One Time', number_billed: null, total_periods: null,
  sale_date: '2026-09-01', next_billing_date: null, inactive_date: null,
  trainer_name: 'Eli Mance', sales_person_name: 'Steve Vedder', ...extra,
})
const sessions = (...days) => days.map(d => ({ day: d }))

test('isSessionEvent: real PT sessions only', () => {
  for (const n of ['PT60', 'PT30', 'PT 60MIN', 'PT 60MIN DBL', 'PT 60 NFW', 'PARTNER60', 'Partner Training'])
    assert.equal(isSessionEvent({ event_name: n, status: 'Completed' }), true, n)
  assert.equal(isSessionEvent({ event_name: 'PT60', status: 'Canceled-Charge' }), true)
  for (const n of ['PT Consult', 'PT Consult #2', 'Admin', 'Floor Hour', 'PRIVATE SWIM', 'STRETCH THERAPY 60'])
    assert.equal(isSessionEvent({ event_name: n, status: 'Completed' }), false, n)
  assert.equal(isSessionEvent({ event_name: 'PT60', status: 'Canceled' }), false)
})

test('no PT ever: status None, nothing else', () => {
  const s = summarizePt([], [], TODAY)
  assert.equal(s.status, 'None')
  assert.deepEqual(desiredPtFields(s), { 'contact.pt_status': 'None' })
})

test('active recurring client', () => {
  const s = summarizePt([recurring()], [], TODAY)
  assert.deepEqual(desiredPtFields(s), {
    'contact.pt_status': 'Active',
    'contact.pt_type': 'Recurring',
    'contact.pt_trainer': 'Amber Sarno',
    'contact.pt_package': 'PT60',
    'contact.pt_price_per_session': 87.5,
    'contact.pt_billing_amount': 350,
    'contact.pt_billing_frequency': 'Monthly',
    'contact.pt_term': '5 payments',
    'contact.pt_payments_made': 2,
    'contact.pt_start_date': '2026-08-01',
    'contact.pt_next_billing_date': '2026-10-25',
    'contact.pt_sold_by': 'Tom Anderson',
  })
})

test('open-ended recurring term reads Open', () => {
  assert.equal(desiredPtFields(summarizePt([recurring({ total_periods: null })], [], TODAY))['contact.pt_term'], 'Open')
})

test('ended recurring: Past Client with end date, no next billing', () => {
  const f = desiredPtFields(summarizePt([recurring({ status: 'inactive', inactive_date: '2026-07-15' })], [], TODAY))
  assert.equal(f['contact.pt_status'], 'Past Client')
  assert.equal(f['contact.pt_end_date'], '2026-07-15')
  assert.equal(f['contact.pt_next_billing_date'], undefined)
})

test('PIF with sessions left is Active (ABC calls every PIF inactive)', () => {
  const s = summarizePt([pif()], sessions('2026-09-03', '2026-09-10', '2026-09-17'), TODAY)
  const f = desiredPtFields(s)
  assert.equal(f['contact.pt_status'], 'Active')
  assert.equal(f['contact.pt_type'], 'PIF')
  assert.equal(f['contact.pt_term'], 'Paid in Full')
  assert.equal(f['contact.pt_billing_frequency'], 'One Time')
  assert.equal(f['contact.pt_sessions_purchased'], 10)
  assert.equal(f['contact.pt_sessions_remaining'], 7)
  assert.equal(f['contact.pt_payments_made'], undefined)
})

test('PIF used up: Past Client, end date = the last session', () => {
  const four = pif({ invoice_total: '280' }) // 4 sessions
  const f = desiredPtFields(summarizePt([four], sessions('2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30'), TODAY))
  assert.equal(f['contact.pt_status'], 'Past Client')
  assert.equal(f['contact.pt_sessions_remaining'], 0)
  assert.equal(f['contact.pt_end_date'], '2026-09-23')
})

test('sessions before the purchase do not count against it', () => {
  const f = desiredPtFields(summarizePt([pif()], sessions('2026-08-20', '2026-08-27'), TODAY))
  assert.equal(f['contact.pt_sessions_remaining'], 10)
})

test('two PIFs: sessions use up the older one first', () => {
  const older = pif({ sale_date: '2026-08-01', invoice_total: '140' }) // 2 sessions
  const newer = pif({ sale_date: '2026-09-01', invoice_total: '280', trainer_name: 'New Trainer' }) // 4
  const s = summarizePt([older, newer], sessions('2026-08-05', '2026-08-12', '2026-09-05'), TODAY)
  const f = desiredPtFields(s)
  assert.equal(f['contact.pt_status'], 'Active')
  assert.equal(f['contact.pt_trainer'], 'New Trainer')
  assert.equal(f['contact.pt_sessions_remaining'], 3)
})

test('PIF bought before the calendar history starts: estimated use before Jan 2026', () => {
  // 10 sessions sold 2025-10-01; ~92 days before 2026-01-01 at 5.3 per 30 days ~= 16 used -> done.
  const f = desiredPtFields(summarizePt([pif({ sale_date: '2025-10-01' })], [], TODAY))
  assert.equal(f['contact.pt_status'], 'Past Client')
  assert.equal(f['contact.pt_sessions_remaining'], 0)
})

test('active recurring beats a used-up PIF, and the newest active wins', () => {
  const s = summarizePt([pif({ invoice_total: '70' }), recurring({ sale_date: '2026-06-01' })], sessions('2026-09-02'), TODAY)
  assert.equal(desiredPtFields(s)['contact.pt_type'], 'Recurring')
  const two = summarizePt([recurring({ sale_date: '2026-06-01', trainer_name: 'Old' }), recurring({ sale_date: '2026-09-20', trainer_name: 'New' })], [], TODAY)
  assert.equal(desiredPtFields(two)['contact.pt_trainer'], 'New')
})

test('ptFieldUpdates: only changed fields, and stale values get cleared', () => {
  const ids = Object.fromEntries(PT_FIELD_KEYS.map((k, i) => [k, `f${i}`]))
  const id = k => ids[k]
  const s = summarizePt([recurring({ status: 'inactive', inactive_date: '2026-07-15' })], [], TODAY)
  const current = {
    [id('contact.pt_status')]: 'Active',
    [id('contact.pt_trainer')]: 'Amber Sarno',
    [id('contact.pt_price_per_session')]: 87.5,
    [id('contact.pt_start_date')]: Date.parse('2026-08-01T00:00:00Z'), // GHL epoch ms
    [id('contact.pt_next_billing_date')]: Date.parse('2026-10-25T00:00:00Z'),
  }
  const u = ptFieldUpdates(s, current, ids)
  assert.equal(u[id('contact.pt_status')], 'Past Client')
  assert.equal(u[id('contact.pt_next_billing_date')], '') // cleared
  assert.equal(u[id('contact.pt_trainer')], undefined) // unchanged
  assert.equal(u[id('contact.pt_price_per_session')], undefined)
  assert.equal(u[id('contact.pt_start_date')], undefined)
  assert.equal(u[id('contact.pt_end_date')], '2026-07-15')
})

test('ptFieldUpdates: fields the location does not have are skipped', () => {
  const u = ptFieldUpdates(summarizePt([], [], TODAY), {}, {})
  assert.deepEqual(u, {})
})
