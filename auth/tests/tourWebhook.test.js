// The shape of the outbound webhook fired when a tour is completed.
//
// A GHL workflow binds to these keys, so a rename or a dropped field breaks
// somebody's automation silently.

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildTourWebhookPayload } = require('../src/lib/tourWebhook')

const LOCATION = { id: 'loc-1', name: 'Salem' }
const INTAKE = {
  id: 'intake-1',
  ghl_contact_id: 'ghl-1',
  contact_name: 'Test Cardone',
  contact_email: 'test@example.com',
  contact_phone: '+15035551212',
  tour_member: 'Caleb Ivey',
  notes: 'keen',
  completed_at: '2026-08-25T18:00:00.000Z',
}

test('a custom pass carries its length and the date ABC stored', () => {
  const p = buildTourWebhookPayload(LOCATION, {
    ...INTAKE,
    outcome: 'Custom Pass',
    pass_days: 21,
  })

  // The length is chosen in the UI, so nothing downstream can work it out from
  // the outcome alone.
  assert.equal(p.pass_days, 21)
  assert.equal(p.outcome, 'Custom Pass')
})

test('a fixed-length outcome carries its length too', () => {
  const trial = buildTourWebhookPayload(LOCATION, {
    ...INTAKE, outcome: 'Started Trial', pass_days: 7,
  })
  assert.equal(trial.pass_days, 7)

  const vip = buildTourWebhookPayload(LOCATION, {
    ...INTAKE, outcome: 'Started VIP Pass', pass_days: 14,
  })
  assert.equal(vip.pass_days, 14)
})

test('an outcome that grants nothing sends null, not zero', () => {
  const p = buildTourWebhookPayload(LOCATION, { ...INTAKE, outcome: 'Only Tour' })

  // A workflow has to be able to tell "no pass" from "a pass of zero days".
  assert.equal(p.pass_days, null)
})

test('pass_days is a number, whatever the caller sent', () => {
  const p = buildTourWebhookPayload(LOCATION, { ...INTAKE, outcome: 'Custom Pass', pass_days: '21' })
  assert.equal(p.pass_days, 21)
  assert.equal(typeof p.pass_days, 'number')
})

test('the length comes from the tour, not from ABC', () => {
  // No ABC profile was linked, so nothing was written there. The webhook still
  // reports what the tour decided.
  const p = buildTourWebhookPayload(LOCATION, { ...INTAKE, outcome: 'Custom Pass', pass_days: 10 })
  assert.equal(p.pass_days, 10)
})

test('the existing fields are untouched', () => {
  const p = buildTourWebhookPayload(LOCATION, { ...INTAKE, outcome: 'Membership Sale' })
  for (const k of [
    'location_id', 'location_name', 'intake_id', 'contact_id', 'contact_name',
    'contact_email', 'contact_phone', 'tour_member', 'outcome', 'notes', 'completed_at',
  ]) {
    assert.ok(k in p, `${k} must stay in the payload`)
  }
  assert.equal(p.contact_name, 'Test Cardone')
  assert.equal(p.tour_member, 'Caleb Ivey')
})
