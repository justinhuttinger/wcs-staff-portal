const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

// ticketNotify pulls in the Supabase client and the Chat sender at require
// time; neither is needed to exercise the message copy, so stub both before
// loading the module. Keeps this a pure unit test with no env or network.
require.cache[require.resolve(path.join(__dirname, 'supabase.js'))] = {
  id: 'supabase-stub', filename: 'supabase-stub', loaded: true, exports: { supabaseAdmin: {} },
}
require.cache[require.resolve(path.join(__dirname, 'googleChat.js'))] = {
  id: 'googleChat-stub', filename: 'googleChat-stub', loaded: true, exports: { sendTicketDm: async () => ({}) },
}

const { composeMessage } = require('./ticketNotify')

const ticket = { id: '400d3c67-f328-4a01-bb11-4429fc9cc6d8', title: 'Broken treadmill in Medford' }

test('assignment names the ticket', () => {
  const msg = composeMessage({ kind: 'assigned', ticket })
  assert.strictEqual(msg, 'Assigned you "Broken treadmill in Medford".')
})

test('comment mention names the ticket and quotes the excerpt', () => {
  const msg = composeMessage({
    kind: 'mentioned_comment',
    ticket,
    commentExcerpt: 'can you take a look @[Seth Tripp](user:aa11bb22-2222-4ccc-9ddd-abcdef012345)',
  })
  assert.strictEqual(msg, 'Mentioned you on "Broken treadmill in Medford": can you take a look @Seth Tripp')
})

test('body mention names the ticket', () => {
  assert.strictEqual(
    composeMessage({ kind: 'mentioned_body', ticket }),
    'Tagged you on "Broken treadmill in Medford".',
  )
})

test('no message of any kind carries a URL', () => {
  const kinds = ['assigned', 'mentioned_comment', 'mentioned_body', 'something_else']
  for (const kind of kinds) {
    const msg = composeMessage({ kind, ticket, commentExcerpt: 'hi' })
    assert.ok(!/https?:\/\//.test(msg), `${kind} should not contain a link, got: ${msg}`)
    assert.ok(msg.includes('Broken treadmill in Medford'), `${kind} should name the ticket, got: ${msg}`)
  }
})

test('an empty comment excerpt drops the trailing colon', () => {
  assert.strictEqual(
    composeMessage({ kind: 'mentioned_comment', ticket, commentExcerpt: '   ' }),
    'Mentioned you on "Broken treadmill in Medford".',
  )
})

test('a titleless ticket still reads sensibly', () => {
  assert.strictEqual(
    composeMessage({ kind: 'assigned', ticket: { id: 'x', title: null } }),
    'Assigned you "a ticket".',
  )
})

test('urgent tickets keep the warning glyph ahead of the name', () => {
  const msg = composeMessage({ kind: 'assigned', ticket: { ...ticket, priority: 'urgent' } })
  assert.strictEqual(msg, '⚠️ Assigned you "Broken treadmill in Medford".')
})
