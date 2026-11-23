const test = require('node:test')
const assert = require('node:assert/strict')
const { cleanTaskInput, statusPatch, cleanAssigneeIds, diffAssignees } = require('../src/services/projects/taskModel')

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

test('cleanTaskInput: title required, urgent allowed, bad priority refused', () => {
  assert.equal(cleanTaskInput({}).error, 'Title is required')
  assert.equal(cleanTaskInput({ title: 'x', priority: 'urgent' }).fields.priority, 'urgent')
  assert.equal(cleanTaskInput({ title: 'x', priority: 'asap' }).error, 'Bad priority')
})

test('cleanTaskInput: defaults on create; junk dates and category become null', () => {
  const { fields } = cleanTaskInput({ title: '  Order mats  ', due_date: '12/01/2026', category_id: 'nope' })
  assert.equal(fields.title, 'Order mats')
  assert.equal(fields.priority, 'medium')
  assert.equal(fields.due_date, null)
  assert.equal(fields.start_date, null)
  assert.equal(fields.category_id, null)
  assert.equal(fields.description, null)
})

test('cleanTaskInput: start after due is refused', () => {
  assert.equal(cleanTaskInput({ title: 'x', start_date: '2026-12-05', due_date: '2026-12-01' }).error,
    'Start date is after the due date')
  assert.equal(cleanTaskInput({ title: 'x', start_date: '2026-12-01', due_date: '2026-12-01' }).error, undefined)
})

test('cleanTaskInput partial: only the keys sent', () => {
  assert.deepEqual(cleanTaskInput({ priority: 'low' }, { partial: true }).fields, { priority: 'low' })
  assert.equal(cleanTaskInput({ title: ' ' }, { partial: true }).error, 'Title is required')
})

test('statusPatch: complete stamps actor and time, others clear them', () => {
  const now = '2026-11-23T18:00:00.000Z'
  assert.deepEqual(statusPatch('complete', { actorId: A, now }).patch,
    { status: 'complete', completed_at: now, completed_by: A, skip_reason: null })
  assert.deepEqual(statusPatch('in_progress', { actorId: A, now }).patch,
    { status: 'in_progress', completed_at: null, completed_by: null, skip_reason: null })
  assert.equal(statusPatch('deleted').error, 'Bad status')
})

test('statusPatch: skipped keeps a trimmed reason, empty reason is null', () => {
  assert.equal(statusPatch('skipped', { reason: '  not needed  ' }).patch.skip_reason, 'not needed')
  assert.equal(statusPatch('skipped', { reason: '' }).patch.skip_reason, null)
})

test('cleanAssigneeIds: members only, de-duplicated', () => {
  assert.deepEqual(cleanAssigneeIds([A, A, C, 'junk', B], [A, B]), [A, B])
  assert.deepEqual(cleanAssigneeIds('nope', [A]), [])
})

test('diffAssignees: adds and removes', () => {
  assert.deepEqual(diffAssignees([A, B], [B, C]), { add: [C], remove: [A] })
  assert.deepEqual(diffAssignees([], [A]), { add: [A], remove: [] })
})
