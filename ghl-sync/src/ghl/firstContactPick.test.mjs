import { test } from 'node:test'
import assert from 'node:assert/strict'
import pkg from './firstContactPick.js'
const { pickFirstHumanContact } = pkg

// Every human-initiated send carries the staff member's userId, so the default
// fixture has one. Cases that deliberately lack it override it to undefined.
const M = (o) => ({ direction: 'outbound', source: 'app', messageType: 'TYPE_SMS', userId: 'staff-1', ...o })

test('picks earliest outbound app SMS/call, ignores workflow/inbound/email', () => {
  const msgs = [
    M({ dateAdded: '2026-06-01T10:00:00Z', source: 'workflow' }),
    M({ dateAdded: '2026-06-01T10:05:00Z', direction: 'inbound' }),
    M({ dateAdded: '2026-06-01T10:30:00Z', messageType: 'TYPE_EMAIL' }),
    M({ dateAdded: '2026-06-01T11:00:00Z' }),
    M({ dateAdded: '2026-06-01T12:00:00Z', messageType: 'TYPE_CALL' }),
  ]
  const r = pickFirstHumanContact(msgs)
  assert.equal(r.at, '2026-06-01T11:00:00Z')
  assert.equal(r.kind, 'sms')
})

test('recognizes a human call', () => {
  const r = pickFirstHumanContact([M({ dateAdded: '2026-06-02T09:00:00Z', messageType: 'TYPE_CALL' })])
  assert.equal(r.kind, 'call')
})

test('returns null when no human SMS/call', () => {
  assert.equal(pickFirstHumanContact([M({ source: 'workflow' }), M({ direction: 'inbound' })]), null)
  assert.equal(pickFirstHumanContact([]), null)
})

// The two rules that make userId load-bearing. Neither had coverage, which is
// how the fixtures drifted out of sync with the implementation unnoticed.

test('a human-dialed call counts even though GHL tags it source:workflow', () => {
  // GHL's dialer stamps source:'workflow' on calls a human places. Keying calls
  // on source:'app' is what made JT Nelms' 7h call read as 36h.
  const r = pickFirstHumanContact([
    M({ dateAdded: '2026-06-03T09:00:00Z', messageType: 'TYPE_CALL', source: 'workflow' }),
  ])
  assert.equal(r.kind, 'call')
  assert.equal(r.at, '2026-06-03T09:00:00Z')
})

test('an app-sourced SMS with no userId is not a human reach', () => {
  // The Day One booking confirmation auto-text is source:'app' but carries no
  // staff userId. Counting it would credit staff with a contact they never made.
  assert.equal(
    pickFirstHumanContact([M({ dateAdded: '2026-06-03T09:00:00Z', userId: undefined })]),
    null,
  )
})
