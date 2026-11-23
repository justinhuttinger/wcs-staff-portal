import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterTasks, sortTasks, groupByStatus, DEFAULT_FILTERS, describeActivity, mergeThread, boardColumns, dropOrder } from './model.js'

const ME = 'me-id'
const YOU = 'you-id'
const today = '2026-11-23'
const t = (id, o = {}) => ({ id, title: id, status: 'not_started', priority: 'medium', assignees: [], created_at: '2026-11-01', ...o })

const tasks = [
  t('mine', { assignees: [{ staff_id: ME }], due_date: '2026-11-20' }),
  t('yours', { assignees: [{ staff_id: YOU }], due_date: '2026-11-25', status: 'in_progress' }),
  t('both', { assignees: [{ staff_id: ME }, { staff_id: YOU }], status: 'complete' }),
  t('skip', { assignees: [{ staff_id: ME }], status: 'skipped' }),
  t('nobody', { description: 'Order new MATS', category_id: 'cat1', priority: 'urgent' }),
]
const ids = list => list.map(x => x.id)
const run = f => ids(filterTasks(tasks, { ...DEFAULT_FILTERS, ...f }, { me: ME, today }))

test('default: my open tasks only', () => {
  assert.deepEqual(run({}), ['mine'])
})

test('all people, all statuses still hides skipped; skipped shows when picked', () => {
  assert.deepEqual(run({ who: 'all', status: 'all' }), ['mine', 'yours', 'both', 'nobody'])
  assert.deepEqual(run({ who: 'all', status: 'skipped' }), ['skip'])
})

test('a specific person', () => {
  assert.deepEqual(run({ who: YOU, status: 'all' }), ['yours', 'both'])
})

test('due filters: overdue is open-only, week is the next 7 days', () => {
  assert.deepEqual(run({ who: 'all', due: 'overdue' }), ['mine'])
  assert.deepEqual(run({ who: 'all', due: 'week' }), ['yours'])
  assert.deepEqual(run({ who: 'all', status: 'all', due: 'none' }), ['both', 'nobody'])
})

test('category, priority and search (description, case-insensitive)', () => {
  assert.deepEqual(run({ who: 'all', category: 'cat1' }), ['nobody'])
  assert.deepEqual(run({ who: 'all', category: 'none' }), ['mine', 'yours'])
  assert.deepEqual(run({ who: 'all', priority: 'urgent' }), ['nobody'])
  assert.deepEqual(run({ who: 'all', q: 'mats' }), ['nobody'])
})

test('sort by priority then due; due puts undated last', () => {
  assert.deepEqual(ids(sortTasks(tasks, 'priority'))[0], 'nobody')
  assert.deepEqual(ids(sortTasks(tasks, 'due')).slice(0, 2), ['mine', 'yours'])
})

test('groupByStatus keeps board order and drops empty groups', () => {
  const g = groupByStatus([t('a', { status: 'complete' }), t('b')])
  assert.deepEqual(g.map(x => x.value), ['not_started', 'complete'])
})

test('describeActivity reads like a sentence', () => {
  const names = { a: 'Alex', b: 'Jon', c: 'Paige' }
  const ctx = { nameOf: id => names[id] || 'Former member', categoryName: id => (id === 'k' ? 'Marketing' : '') }
  const say = (kind, detail) => describeActivity({ actor_id: 'a', kind, detail }, ctx)
  assert.equal(say('status', { from: 'not_started', to: 'in_progress' }), 'Alex moved this to In Progress')
  assert.equal(say('status', { from: 'in_progress', to: 'complete' }), 'Alex marked this Complete')
  assert.equal(say('status', { from: 'in_progress', to: 'skipped', reason: 'dup' }), 'Alex skipped this task: dup')
  assert.equal(say('status', { from: 'skipped', to: 'not_started' }), 'Alex restored this task')
  assert.equal(say('assigned', { staff_ids: ['b', 'c'] }), 'Alex assigned Jon, Paige')
  assert.equal(say('due_date', { from: null, to: '2026-12-05' }), 'Alex set the due date to Dec 5')
  assert.equal(say('due_date', { from: '2026-12-05', to: null }), 'Alex cleared the due date')
  assert.equal(say('priority', { to: 'urgent' }), 'Alex changed priority to Urgent')
  assert.equal(say('category', { to: 'k' }), 'Alex moved this to Marketing')
  assert.equal(describeActivity({ actor_id: null, kind: 'created' }, ctx), 'Someone created this task')
})

test('mergeThread interleaves comments and history by time', () => {
  const out = mergeThread(
    [{ id: 'c1', created_at: '2026-11-23T10:00:00Z' }],
    [{ id: 'a1', created_at: '2026-11-23T09:00:00Z' }, { id: 'a2', created_at: '2026-11-23T11:00:00Z' }])
  assert.deepEqual(out.map(x => x.item.id), ['a1', 'c1', 'a2'])
})

test('board: status any includes skipped; columns hide skipped unless asked', () => {
  assert.deepEqual(run({ who: 'all', status: 'any' }), ['mine', 'yours', 'both', 'skip', 'nobody'])
  const cols = boardColumns([t('a', { sort_order: 2 }), t('b', { sort_order: 1 }), t('s', { status: 'skipped' })])
  assert.deepEqual(cols.map(c => c.value), ['not_started', 'in_progress', 'complete'])
  assert.deepEqual(cols[0].items.map(x => x.id), ['b', 'a'])
  assert.equal(boardColumns([], { showSkipped: true }).length, 4)
})

test('dropOrder lands between neighbours, or past the ends', () => {
  const items = [{ sort_order: 10 }, { sort_order: 20 }]
  assert.equal(dropOrder(items, 1), 15)
  assert.equal(dropOrder(items, 0), 10 - 1024)
  assert.equal(dropOrder(items, 2), 20 + 1024)
  assert.ok(dropOrder([], 0) > 0)
})
