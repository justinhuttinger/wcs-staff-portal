const test = require('node:test')
const assert = require('node:assert')
const { canReuseTicket } = require('./ticketingSchema')

// Guards the retry path added after "New Hire - Rocio Tello" was submitted three
// times on 2026-08-24: the ticket row is written before its attachments upload,
// so an upload failure leaves a real ticket and the user resubmits. A retry may
// refresh that first ticket, but only under narrow conditions.

const ME = 'staff-1'
const TYPE = 'type-a'
const prior = (over = {}) => ({ id: 't1', submitter_id: ME, type_id: TYPE, status: 'open', ...over })
const opts = { staffId: ME, typeId: TYPE }

test('reuses the submitter\'s own untouched ticket of the same type', () => {
  assert.equal(canReuseTicket(prior(), opts), true)
})

test('never reuses someone else\'s ticket', () => {
  assert.equal(canReuseTicket(prior({ submitter_id: 'staff-2' }), opts), false)
})

test('never reuses a ticket of a different type', () => {
  assert.equal(canReuseTicket(prior({ type_id: 'type-b' }), opts), false)
})

test('never reuses a ticket a handler has already picked up', () => {
  for (const status of ['in_progress', 'complete', 'closed']) {
    assert.equal(canReuseTicket(prior({ status }), opts), false, status)
  }
})

test('a missing or stray ticket id falls through to a normal insert', () => {
  assert.equal(canReuseTicket(null, opts), false)
  assert.equal(canReuseTicket(undefined, opts), false)
})

test('missing caller context never reuses', () => {
  assert.equal(canReuseTicket(prior(), { staffId: null, typeId: TYPE }), false)
  assert.equal(canReuseTicket(prior(), { staffId: ME, typeId: null }), false)
  assert.equal(canReuseTicket(prior(), {}), false)
})
