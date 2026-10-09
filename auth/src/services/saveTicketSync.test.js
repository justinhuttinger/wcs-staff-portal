const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveRequestForTicket, completeTicketForRequest } = require('./saveTicketSync')

// Minimal supabase-js stand-in: records every chain and answers from `rows`.
function fakeDb(rows = {}) {
  const calls = []
  const db = {
    calls,
    from(table) {
      const call = { table, ops: [] }
      calls.push(call)
      const chain = {
        then(resolve) { resolve({ data: call.op === 'select-one' ? (rows[table] ?? null) : (rows[table] ? [rows[table]] : []), error: null }) },
      }
      for (const op of ['select', 'update', 'insert', 'eq', 'is']) {
        chain[op] = (...args) => { call.ops.push([op, ...args]); return chain }
      }
      chain.maybeSingle = () => { call.op = 'select-one'; return chain }
      return chain
    },
  }
  return db
}

test('completing a cancel-action ticket resolves its open save request', async () => {
  const db = fakeDb({ save_requests: { id: 'r1' } })
  const out = await resolveRequestForTicket(db, { ticketId: 't1', typeSlug: 'cancel-action', status: 'complete', staffId: 's1' })
  assert.deepEqual(out, [{ id: 'r1' }])
  const ops = db.calls[0].ops
  assert.equal(ops[0][0], 'update')
  assert.equal(ops[0][1].resolved_by, 's1')
  assert.equal(ops[0][1].resolution_note, 'Ticket marked complete')
  assert.deepEqual(ops.slice(1, 3), [['eq', 'ticket_id', 't1'], ['is', 'resolved_at', null]])
})

test('other ticket types and non-final statuses leave save requests alone', async () => {
  const db = fakeDb()
  assert.equal(await resolveRequestForTicket(db, { ticketId: 't1', typeSlug: 'new-hire-form', status: 'complete' }), null)
  assert.equal(await resolveRequestForTicket(db, { ticketId: 't1', typeSlug: 'cancel-action', status: 'in_progress' }), null)
  assert.equal(db.calls.length, 0)
})

test('resolving a request completes its open ticket with a system note', async () => {
  const db = fakeDb({ tickets: { id: 't1', status: 'open' } })
  assert.equal(await completeTicketForRequest(db, { request: { id: 'r1', ticket_id: 't1' }, staffId: 's1' }), 't1')
  const update = db.calls[1].ops.find(o => o[0] === 'update')[1]
  assert.equal(update.status, 'complete')
  const note = db.calls[2]
  assert.equal(note.table, 'ticket_comments')
  assert.equal(note.ops[0][1].system, true)
})

test('no ticket, or one already complete, is left alone', async () => {
  const db = fakeDb({ tickets: { id: 't1', status: 'complete' } })
  assert.equal(await completeTicketForRequest(db, { request: { id: 'r1', ticket_id: null } }), null)
  assert.equal(await completeTicketForRequest(db, { request: { id: 'r1', ticket_id: 't1' } }), null)
  assert.equal(db.calls.length, 1)
})
