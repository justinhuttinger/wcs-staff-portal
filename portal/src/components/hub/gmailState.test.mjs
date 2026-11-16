import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isGmailDisconnected, markGmailLost } from './gmailState.js'

test('a 412 from the API means Gmail must be reconnected', () => {
  const e = Object.assign(new Error('Connect Gmail first'), { httpStatus: 412 })
  assert.equal(isGmailDisconnected(e), true)
  assert.equal(isGmailDisconnected(Object.assign(new Error('x'), { httpStatus: 500 })), false)
  assert.equal(isGmailDisconnected(null), false)
})

test('markGmailLost flips a ready status so the connect card shows', () => {
  assert.deepEqual(markGmailLost({ connected: true, ready: true, email: 'a@b.co' }), { connected: true, ready: false, email: 'a@b.co' })
  assert.deepEqual(markGmailLost(null), { ready: false })
})
