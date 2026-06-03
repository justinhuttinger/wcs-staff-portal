import { test } from 'node:test'
import assert from 'node:assert/strict'
import pkg from './firstContactPick.js'
const { pickFirstHumanContact } = pkg

const M = (o) => ({ direction: 'outbound', source: 'app', messageType: 'TYPE_SMS', ...o })

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
