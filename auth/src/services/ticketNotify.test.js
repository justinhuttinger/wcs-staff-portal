const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

// Stub the two IO modules before ticketNotify loads them: a chainable Supabase
// double that hands back one staff row, and a Chat sender that records which
// path was used. Keeps this a pure unit test — no env, no network.
const sent = []

function staffRow() {
  return { id: 'target-1', email: 'seth@wcstrength.com', chat_notifications_enabled: true }
}

function queryStub(table) {
  const chain = {
    select() { return chain },
    eq() { return chain },
    async maybeSingle() { return { data: table === 'staff' ? staffRow() : null, error: null } },
    async insert() { return { data: null, error: null } },
  }
  // finish() awaits .update(...).eq(...) directly
  chain.update = () => ({ eq: async () => ({ error: null }) })
  return chain
}

require.cache[require.resolve(path.join(__dirname, 'supabase.js'))] = {
  id: 'supabase-stub', filename: 'supabase-stub', loaded: true,
  exports: { supabaseAdmin: { from: queryStub } },
}
require.cache[require.resolve(path.join(__dirname, 'googleChat.js'))] = {
  id: 'googleChat-stub', filename: 'googleChat-stub', loaded: true,
  exports: {
    sendTicketDm: async ({ targetEmail, text }) => {
      sent.push({ via: 'actor', targetEmail, text }); return { messageName: 'm1' }
    },
    sendTicketDmAsSystem: async ({ targetEmail, text }) => {
      sent.push({ via: 'system', targetEmail, text }); return { messageName: 'm2' }
    },
  },
}

const { composeMessage, notify } = require('./ticketNotify')

const ticket = { id: '400d3c67-f328-4a01-bb11-4429fc9cc6d8', title: 'Broken treadmill in Medford' }

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

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

test('creation copy names the ticket and the submitter', () => {
  assert.strictEqual(
    composeMessage({ kind: 'created', ticket, submitterName: 'Seth Tripp' }),
    'New ticket from Seth Tripp: "Broken treadmill in Medford".',
  )
})

test('creation copy still reads without a submitter name', () => {
  assert.strictEqual(
    composeMessage({ kind: 'created', ticket }),
    'New ticket: "Broken treadmill in Medford".',
  )
})

test('no message of any kind carries a URL', () => {
  const kinds = ['assigned', 'mentioned_comment', 'mentioned_body', 'created', 'something_else']
  for (const kind of kinds) {
    const msg = composeMessage({ kind, ticket, commentExcerpt: 'hi', submitterName: 'Seth Tripp' })
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

// ---------------------------------------------------------------------------
// Routing: who sends, and who gets skipped
// ---------------------------------------------------------------------------

test('creation notices go out through the system sender, not the actor', async () => {
  sent.length = 0
  await notify({
    ticket,
    actorId: 'actor-1',
    fromSystem: true,
    submitterName: 'Seth Tripp',
    targets: [{ targetUserId: 'target-1', kind: 'created' }],
  })
  assert.strictEqual(sent.length, 1)
  assert.strictEqual(sent[0].via, 'system')
})

test('a system notice still reaches someone who is also the actor', async () => {
  // Person-to-person DMs skip the actor; a creation notice must not, or an
  // admin who lists themselves never hears about their own submissions.
  sent.length = 0
  await notify({
    ticket,
    actorId: 'target-1',
    fromSystem: true,
    targets: [{ targetUserId: 'target-1', kind: 'created' }],
  })
  assert.strictEqual(sent.length, 1, 'system notice should not be suppressed as a self-notify')
})

test('person-to-person mentions still skip the actor and send as them', async () => {
  sent.length = 0
  await notify({
    ticket,
    actorId: 'target-1',
    targets: [{ targetUserId: 'target-1', kind: 'mentioned_comment', commentExcerpt: 'hi' }],
  })
  assert.strictEqual(sent.length, 0, 'self-mention must stay silent')

  await notify({
    ticket,
    actorId: 'actor-1',
    targets: [{ targetUserId: 'target-1', kind: 'mentioned_comment', commentExcerpt: 'hi' }],
  })
  assert.strictEqual(sent.length, 1)
  assert.strictEqual(sent[0].via, 'actor')
})
