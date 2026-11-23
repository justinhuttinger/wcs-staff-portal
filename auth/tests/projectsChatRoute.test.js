// End-to-end through POST /projects-chat/events with Google verification,
// the database and task creation stubbed.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const express = require('express')

function prime(rel, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', rel))
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
}

const STAFF = {
  'justin@example.com': { id: 'u1', email: 'justin@example.com', display_name: 'Justin', is_active: true },
  'alex@example.com': { id: 'u2', email: 'alex@example.com', display_name: 'Alex', is_active: true },
  'temp@example.com': { id: 'u9', email: 'temp@example.com', display_name: 'Temp', is_active: true },
}
const MEMBERS = ['u1', 'u2']
let created = []

prime('services/supabase.js', { supabaseAdmin: { from: () => {
  let pattern = ''
  const chain = {
    select: () => chain,
    ilike: (_c, p) => { pattern = p.replace(/\\(.)/g, '$1'); return chain },
    limit: async () => ({ data: STAFF[pattern] ? [STAFF[pattern]] : [], error: null }),
  }
  return chain
} } })
prime('services/projects/chatVerify.js', {
  bearer: req => (req.headers.authorization || '').replace('Bearer ', ''),
  verifyChatToken: async (token, { serviceAccountEmail }) => (token === 'good' && serviceAccountEmail ? { ok: true } : { ok: false, reason: 'bad' }),
})
prime('services/projects/members.js', { isProjectsMember: async id => MEMBERS.includes(id) })
prime('services/projects/store.js', {
  memberList: async () => [{ id: 'u1', name: 'Justin' }, { id: 'u2', name: 'Alex' }],
  categoryList: async () => [{ id: 'c1', name: 'Marketing' }],
  createTask: async (body, actor) => {
    created.push({ body, actor: actor.id })
    return { id: 't1', title: body.title, due_date: body.due_date, assignees: body.assignee_ids.map(staff_id => ({ staff_id })) }
  },
})

process.env.PROJECTS_CHAT_SA_EMAIL = 'service-1@gcp-sa-gsuiteaddons.iam.gserviceaccount.com'
process.env.PROJECTS_CHAT_ENDPOINT = 'https://api.example.com/projects-chat/events'
const app = express()
app.use(express.json())
app.use('/projects-chat', require('../src/routes/projectsChat'))

let server, base
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}` })
test.after(() => server.close())
test.beforeEach(() => { created = [] })

const post = (body, token = 'good') => fetch(`${base}/projects-chat/events`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
})
const command = email => ({ chat: { user: { email }, appCommandPayload: { appCommandMetadata: { appCommandId: 1, appCommandType: 'SLASH_COMMAND' } } } })
const submit = (email, inputs) => ({ chat: { user: { email }, buttonClickedPayload: {} }, commonEventObject: { parameters: { actionName: 'createTask' }, formInputs: inputs } })

test('an unsigned or wrongly signed request is refused', async () => {
  assert.equal((await post(command('justin@example.com'), 'forged')).status, 401)
})

test('/task from a member opens the form with them pre-selected', async () => {
  const r = await (await post(command('Justin@Example.com'))).json()
  const card = r.action.navigations[0].pushCard
  assert.equal(card.header.title, 'New task')
  const assignees = card.sections[0].widgets.find(w => w.selectionInput?.name === 'assignees').selectionInput
  assert.deepEqual(assignees.items.filter(i => i.selected).map(i => i.value), ['u1'])
})

test('/task from a non-member or unknown person explains instead of opening the form', async () => {
  const notMember = await (await post(command('temp@example.com'))).json()
  assert.match(JSON.stringify(notMember), /Ask an admin to add you/)
  const unknown = await (await post(command('stranger@example.com'))).json()
  assert.match(JSON.stringify(unknown), /No portal account matches stranger@example.com/)
})

test('submit creates the task as the person and closes with a summary', async () => {
  const r = await (await post(submit('alex@example.com', {
    title: { stringInputs: { value: ['Order mats'] } },
    assignees: { stringInputs: { value: ['u1'] } },
    priority: { stringInputs: { value: ['high'] } },
    category: { stringInputs: { value: ['c1'] } },
    due_date: { dateInput: { msSinceEpoch: Date.UTC(2026, 11, 5) } },
  }))).json()
  assert.deepEqual(created, [{ actor: 'u2', body: { title: 'Order mats', description: '', assignee_ids: ['u1'], priority: 'high', category_id: 'c1', due_date: '2026-12-05' } }])
  assert.equal(r.action.navigations[0].endNavigation.action, 'CLOSE_DIALOG')
  assert.equal(r.action.notification.text, 'Created "Order mats" · assigned to Justin · due Dec 5')
})

test('submit without a title keeps the form open with an error and what was typed', async () => {
  const r = await (await post(submit('justin@example.com', { description: { stringInputs: { value: ['details'] } } }))).json()
  assert.equal(created.length, 0)
  const card = r.action.navigations[0].updateCard
  assert.match(card.sections[0].widgets[0].textParagraph.text, /Add a title/)
  assert.equal(card.sections[0].widgets.find(w => w.textInput?.name === 'description').textInput.value, 'details')
})

test('a plain message gets the help reply', async () => {
  const r = await (await post({ chat: { user: { email: 'justin@example.com' }, messagePayload: { message: { text: 'hi' } } } })).json()
  assert.match(r.hostAppDataAction.chatDataAction.createMessageAction.message.text, /Type \/task/)
})
