const test = require('node:test')
const assert = require('node:assert/strict')
const { planNotifications, taskLink, dueText } = require('../src/services/projects/notifyPlan')

const ME = '11111111-1111-4111-8111-111111111111'
const ALEX = '22222222-2222-4222-8222-222222222222'
const JON = '33333333-3333-4333-8333-333333333333'
const OUTSIDER = '44444444-4444-4444-8444-444444444444'
const BASE = 'https://portal.example.com'

const task = {
  id: 'task-1', title: 'Order mats', priority: 'high', due_date: '2026-12-05',
  assignees: [{ staff_id: ME }, { staff_id: ALEX }],
}
const plan = o => planNotifications({ task, actorId: ME, actorName: 'Justin', base: BASE, memberIds: [ME, ALEX, JON], ...o })

test('assigned: only the newly added, never the actor, with priority and due', () => {
  const out = plan({ event: 'assigned', added: [ME, ALEX] })
  assert.equal(out.length, 1)
  assert.equal(out[0].targetId, ALEX)
  assert.equal(out[0].kind, 'assigned')
  assert.equal(out[0].text, 'Justin assigned you "Order mats" · High · due Dec 5\n<https://portal.example.com/?task=task-1|Open task>')
})

test('comment: assignees get the full message; a mentioned non-assignee member gets "mentioned"', () => {
  const body = `Can you check this @[Jon](user:${JON}) and @[Out](user:${OUTSIDER})?`
  const out = plan({ event: 'comment', commentBody: body })
  assert.deepEqual(out.map(r => [r.targetId, r.kind]), [[ALEX, 'comment'], [JON, 'mentioned']])
  assert.equal(out[0].text, 'Justin commented on "Order mats":\nCan you check this @Jon and @Out?\n<https://portal.example.com/?task=task-1|Open task>')
  assert.match(out[1].text, /^Justin mentioned you on "Order mats":/)
})

test('comment: an assignee who is also mentioned gets one message', () => {
  const out = plan({ event: 'comment', commentBody: `@[Alex](user:${ALEX}) done?` })
  assert.deepEqual(out.map(r => [r.targetId, r.kind]), [[ALEX, 'comment']])
})

test('complete: every assignee but the actor', () => {
  const out = plan({ event: 'complete' })
  assert.deepEqual(out.map(r => r.targetId), [ALEX])
  assert.equal(out[0].text, 'Justin marked "Order mats" complete\n<https://portal.example.com/?task=task-1|Open task>')
})

test('long comments are cut; helpers format links and dates', () => {
  const out = plan({ event: 'comment', commentBody: 'x'.repeat(3000) })
  assert.ok(out[0].text.includes('x'.repeat(1499) + '…'))
  assert.equal(taskLink('t', 'https://a.b/'), 'https://a.b/?task=t')
  assert.equal(dueText('2026-01-09'), 'Jan 9')
  assert.equal(dueText(null), null)
})
