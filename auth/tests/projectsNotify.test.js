const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

function prime(rel, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', rel))
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
}

const ACTOR = '11111111-1111-4111-8111-111111111111'
const ALEX = '22222222-2222-4222-8222-222222222222'
const JON = '33333333-3333-4333-8333-333333333333'

// Staff rows by id, the log rows written, and the DMs "sent".
let staff = {}
let logged = []
let sent = []
let actorConnected = true

function table(name) {
  const q = { eq: {} }
  const chain = {
    select: () => chain,
    eq: (k, v) => { q.eq[k] = v; return chain },
    maybeSingle: async () => ({ data: name === 'staff' ? staff[q.eq.id] || null : null, error: null }),
    insert: async row => { if (name === 'project_notifications') logged.push(row); return { error: null } },
    then: (resolve) => resolve({ data: name === 'project_members' ? [{ staff_id: ACTOR }, { staff_id: ALEX }, { staff_id: JON }] : [], error: null }),
  }
  return chain
}

prime('services/supabase.js', { supabaseAdmin: { from: table } })
prime('services/googleChat.js', {
  sendTicketDm: async ({ targetEmail, text }) => {
    if (!actorConnected) { const e = new Error('nope'); e.notConnected = true; throw e }
    if (targetEmail === 'gone@example.com') { const e = new Error('x'); e.targetUnreachable = true; throw e }
    sent.push({ as: 'actor', to: targetEmail, text })
  },
  sendTicketDmAsSystem: async ({ targetEmail, text }) => { sent.push({ as: 'system', to: targetEmail, text }) },
})

const { notifyTaskEvent } = require('../src/services/projects/notify')

const task = { id: 'task-1', title: 'Order mats', priority: 'medium', assignees: [{ staff_id: ACTOR }, { staff_id: ALEX }, { staff_id: JON }] }
const actor = { id: ACTOR, display_name: 'Justin' }

test.beforeEach(() => {
  staff = {
    [ALEX]: { id: ALEX, email: 'alex@example.com', is_active: true, chat_notifications_enabled: true },
    [JON]: { id: JON, email: 'jon@example.com', is_active: true, chat_notifications_enabled: true },
  }
  logged = []; sent = []; actorConnected = true
  delete process.env.PROJECTS_CHAT_DISABLED
})

test('complete: sends from the actor to each other assignee and logs it', async () => {
  await notifyTaskEvent({ event: 'complete', task, actor })
  assert.deepEqual(sent.map(s => [s.as, s.to]), [['actor', 'alex@example.com'], ['actor', 'jon@example.com']])
  assert.deepEqual(logged.map(l => [l.target_id, l.status, l.sent_as]), [[ALEX, 'sent', 'actor'], [JON, 'sent', 'actor']])
})

test('actor without Google Chat falls back to the portal account', async () => {
  actorConnected = false
  await notifyTaskEvent({ event: 'assigned', task, actor, added: [ALEX] })
  assert.deepEqual(sent.map(s => [s.as, s.to]), [['system', 'alex@example.com']])
  assert.equal(logged[0].sent_as, 'system')
  assert.match(sent[0].text, /^Justin assigned you "Order mats"/)
})

test('opted-out recipient is skipped; unreachable recipient is a logged failure', async () => {
  staff[ALEX].chat_notifications_enabled = false
  staff[JON].email = 'gone@example.com'
  await notifyTaskEvent({ event: 'complete', task, actor })
  assert.equal(sent.length, 0)
  assert.deepEqual(logged.map(l => [l.target_id, l.status]), [[ALEX, 'skipped'], [JON, 'failed']])
  assert.equal(logged[1].error, 'recipient is not reachable on Google Chat')
})

test('PROJECTS_CHAT_DISABLED=true sends and logs nothing', async () => {
  process.env.PROJECTS_CHAT_DISABLED = 'true'
  await notifyTaskEvent({ event: 'complete', task, actor })
  assert.equal(sent.length + logged.length, 0)
})
