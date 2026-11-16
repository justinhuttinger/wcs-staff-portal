const test = require('node:test')
const assert = require('node:assert/strict')
const { recordSend } = require('../src/services/hub/recordSend')
const { PERSON_LIST_COLS } = require('../src/services/hub/taskModel')

// Fake db: records call order; any method can be told to fail.
function fakeDb(fail = {}) {
  const calls = []
  const op = name => async (...args) => {
    calls.push(name)
    if (fail[name]) return { data: null, error: { message: `${name} failed` } }
    if (name === 'updatePerson') return { data: { id: args[0], ...args[1], name: 'Sam' }, error: null }
    return { data: null, error: null }
  }
  return { calls, updatePerson: op('updatePerson'), insertMessage: op('insertMessage'), updateTask: op('updateTask') }
}

const sent = { id: 'm1', threadId: 't1', messageIdHeader: '<a@b>' }
const now = '2026-11-16T20:00:00.000Z'

test('first email: thread is saved on the person before anything else', async () => {
  const db = fakeDb()
  const r = await recordSend({ db, person: { id: 'p1', gmail_thread_id: null }, task: { id: 'k1', status: 'todo' },
    sent, kind: 'initial', subject: 'Photos', body: 'hi', now })
  assert.equal(db.calls[0], 'updatePerson')
  assert.equal(r.person.gmail_thread_id, 't1')
  assert.equal(r.person.first_message_id_header, '<a@b>')
  assert.equal(r.taskStatus, 'waiting')
  assert.equal(r.warning, null)
})

test('a failed write after Gmail sent never throws; it warns not to resend', async () => {
  const db = fakeDb({ updatePerson: true, insertMessage: true })
  const r = await recordSend({ db, person: { id: 'p1', gmail_thread_id: null, name: 'Sam' }, task: { id: 'k1', status: 'todo' },
    sent, kind: 'initial', subject: 'Photos', body: 'hi', now })
  assert.match(r.warning, /sent/i)
  assert.match(r.warning, /don't send it again/i)
  assert.equal(r.person.gmail_thread_id, 't1')
  assert.equal(r.person.state, 'waiting')
})

test('kind initial on an existing thread is stored as a nudge', async () => {
  const rows = []
  const db = fakeDb()
  db.insertMessage = async row => { rows.push(row); return { error: null } }
  await recordSend({ db, person: { id: 'p1', gmail_thread_id: 't0' }, task: { id: 'k1', status: 'waiting' },
    sent, kind: 'initial', subject: 'Re: Photos', body: 'bump', now })
  assert.equal(rows[0].kind, 'nudge')
})

test('people loaded with tasks carry their subject (for "Re:" on nudges)', () => {
  assert.match(PERSON_LIST_COLS, /\bsubject\b/)
  assert.match(PERSON_LIST_COLS, /\bgmail_thread_id\b/)
})
