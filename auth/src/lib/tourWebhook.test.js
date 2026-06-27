const test = require('node:test')
const assert = require('node:assert')
const { buildTourWebhookPayload } = require('./tourWebhook')

test('builds a flat outcome payload from location + intake', () => {
  const payload = buildTourWebhookPayload(
    { id: 'loc1', name: 'Salem' },
    { id: 'i1', contact_name: 'Jane Doe', contact_email: 'j@x.com',
      contact_phone: '+1555', tour_member: 'John S', outcome: 'Membership Sale',
      notes: 'great', completed_at: '2026-06-27T00:00:00Z' }
  )
  assert.deepEqual(payload, {
    location_id: 'loc1', location_name: 'Salem', intake_id: 'i1',
    contact_name: 'Jane Doe', contact_email: 'j@x.com', contact_phone: '+1555',
    tour_member: 'John S', outcome: 'Membership Sale', notes: 'great',
    completed_at: '2026-06-27T00:00:00Z',
  })
})
