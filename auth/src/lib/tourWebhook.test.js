const test = require('node:test')
const assert = require('node:assert')
const { buildTourWebhookPayload } = require('./tourWebhook')

test('builds a flat outcome payload from location + intake', () => {
  const payload = buildTourWebhookPayload(
    { id: 'loc1', name: 'Salem' },
    { id: 'i1', ghl_contact_id: 'c1', contact_name: 'Jane Doe', contact_email: 'j@x.com',
      contact_phone: '+1555', tour_member: 'John S', outcome: 'Membership Sale',
      notes: 'great', completed_at: '2026-06-27T00:00:00Z' }
  )
  assert.deepStrictEqual(payload, {
    location_id: 'loc1', location_name: 'Salem', intake_id: 'i1', contact_id: 'c1',
    contact_name: 'Jane Doe', contact_email: 'j@x.com', contact_phone: '+1555',
    tour_member: 'John S', outcome: 'Membership Sale', pass_days: null,
    referred_by_full_name: null, referred_by_abc_id: null, vip_team_member: null,
    notes: 'great', referring_member_id: null, referring_member_name: null,
    // Midnight UTC on the 27th is still the evening of the 26th at the club.
    completed_at: '06/26/2026 | 5:00 PM',
  })
})

test('carries the referral and pass detail a VIP outcome adds', () => {
  const payload = buildTourWebhookPayload(
    { id: 'loc1', name: 'Salem' },
    { id: 'i2', outcome: 'Started VIP Pass', pass_days: 14,
      referring_member_id: 'm9', referring_member_name: 'Felix Reyes',
      referred_by_full_name: 'Felix Reyes', referred_by_abc_id: 'abc9',
      vip_team_member: 'Lily Valentine', completed_at: '2026-09-09T23:05:51.004Z' }
  )
  assert.strictEqual(payload.pass_days, 14)
  assert.strictEqual(payload.referring_member_name, 'Felix Reyes')
  assert.strictEqual(payload.vip_team_member, 'Lily Valentine')
  assert.strictEqual(payload.completed_at, '09/09/2026 | 4:05 PM')
})

test('a pass of zero days stays 0, distinct from no pass at all', () => {
  const zero = buildTourWebhookPayload({ id: 'l', name: 'S' }, { id: 'i', pass_days: 0 })
  assert.strictEqual(zero.pass_days, 0)
  const none = buildTourWebhookPayload({ id: 'l', name: 'S' }, { id: 'i' })
  assert.strictEqual(none.pass_days, null)
})

test('an intake with no completion time sends null, not "Invalid Date"', () => {
  const payload = buildTourWebhookPayload({ id: 'l', name: 'S' }, { id: 'i' })
  assert.strictEqual(payload.completed_at, null)
})
