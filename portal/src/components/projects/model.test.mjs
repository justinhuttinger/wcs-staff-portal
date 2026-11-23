import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterTasks, sortTasks, groupByStatus, DEFAULT_FILTERS, normalizeFilters, activeFilterCount, describeActivity, mergeThread, boardColumns, dropOrder } from './model.js'

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

const ALL = ['not_started', 'in_progress', 'complete', 'skipped']
const NO_SKIP = ['not_started', 'in_progress', 'complete']

test('default: my open tasks only', () => {
  assert.deepEqual(run({}), ['mine'])
})

test('everyone with a status list; skipped only when it is in the list', () => {
  assert.deepEqual(run({ scope: 'everyone', statuses: NO_SKIP }), ['mine', 'yours', 'both', 'nobody'])
  assert.deepEqual(run({ scope: 'everyone', statuses: ['skipped'] }), ['skip'])
})

test('everyone narrowed to people; my tasks ignores the people list', () => {
  assert.deepEqual(run({ scope: 'everyone', people: [YOU], statuses: ALL }), ['yours', 'both'])
  assert.deepEqual(run({ scope: 'me', people: [YOU], statuses: NO_SKIP }), ['mine', 'both'])
})

test('due filters: overdue is open-only, week is the next 7 days', () => {
  assert.deepEqual(run({ scope: 'everyone', due: 'overdue' }), ['mine'])
  assert.deepEqual(run({ scope: 'everyone', due: 'week' }), ['yours'])
  assert.deepEqual(run({ scope: 'everyone', statuses: NO_SKIP, due: 'none' }), ['both', 'nobody'])
})

test('category (with none), priority list and search', () => {
  assert.deepEqual(run({ scope: 'everyone', categories: ['cat1'] }), ['nobody'])
  assert.deepEqual(run({ scope: 'everyone', categories: ['none'] }), ['mine', 'yours'])
  assert.deepEqual(run({ scope: 'everyone', priorities: ['urgent', 'high'] }), ['nobody'])
  assert.deepEqual(run({ scope: 'everyone', q: 'mats' }), ['nobody'])
})

test('board mode ignores the status list but hides skipped unless shown', () => {
  const b = o => ids(filterTasks(tasks, { ...DEFAULT_FILTERS, scope: 'everyone' }, { me: ME, today, board: true, ...o }))
  assert.deepEqual(b({}), ['mine', 'yours', 'both', 'nobody'])
  assert.deepEqual(b({ showSkipped: true }), ['mine', 'yours', 'both', 'skip', 'nobody'])
})

test('normalizeFilters keeps valid keys and drops an old shape', () => {
  assert.deepEqual(normalizeFilters({ who: 'all', status: 'open' }), DEFAULT_FILTERS)
  assert.deepEqual(normalizeFilters({ scope: 'everyone', people: ['a'], due: 'week' }), { ...DEFAULT_FILTERS, scope: 'everyone', people: ['a'], due: 'week' })
})

test('activeFilterCount ignores scope and, on the board, status', () => {
  assert.equal(activeFilterCount(DEFAULT_FILTERS), 0)
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, priorities: ['urgent'], due: 'week' }), 2)
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, statuses: ALL }, { board: true }), 0)
})

test('sorts: most urgent then due; due soonest; due latest; recently updated', () => {
  assert.equal(ids(sortTasks(tasks, 'urgent'))[0], 'nobody')
  assert.deepEqual(ids(sortTasks(tasks, 'due')).slice(0, 2), ['mine', 'yours'])
  assert.deepEqual(ids(sortTasks(tasks, 'due_desc')).slice(0, 2), ['yours', 'mine'])
  const u = [t('a', { updated_at: '2026-11-20' }), t('b', { updated_at: '2026-11-22' })]
  assert.deepEqual(ids(sortTasks(u, 'updated')), ['b', 'a'])
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
  assert.equal(say('file_added', { name: 'Plan', type: 'link' }), 'Alex added a link: Plan')
  assert.equal(say('file_removed', { name: 'a.pdf', type: 'file' }), 'Alex removed a file: a.pdf')
})

test('mergeThread interleaves comments and history by time', () => {
  const out = mergeThread(
    [{ id: 'c1', created_at: '2026-11-23T10:00:00Z' }],
    [{ id: 'a1', created_at: '2026-11-23T09:00:00Z' }, { id: 'a2', created_at: '2026-11-23T11:00:00Z' }])
  assert.deepEqual(out.map(x => x.item.id), ['a1', 'c1', 'a2'])
})

test('board columns: drag order by default, chosen sort when given, skipped hidden unless asked', () => {
  const cols = boardColumns([t('a', { sort_order: 2 }), t('b', { sort_order: 1 }), t('s', { status: 'skipped' })])
  assert.deepEqual(cols.map(c => c.value), ['not_started', 'in_progress', 'complete'])
  assert.deepEqual(cols[0].items.map(x => x.id), ['b', 'a'])
  assert.equal(boardColumns([], { showSkipped: true }).length, 4)
  const byUrgent = boardColumns([t('a', { sort_order: 1 }), t('b', { sort_order: 2, priority: 'urgent' })], { sort: 'urgent' })
  assert.deepEqual(byUrgent[0].items.map(x => x.id), ['b', 'a'])
})

test('dropOrder lands between neighbours, or past the ends', () => {
  const items = [{ sort_order: 10 }, { sort_order: 20 }]
  assert.equal(dropOrder(items, 1), 15)
  assert.equal(dropOrder(items, 0), 10 - 1024)
  assert.equal(dropOrder(items, 2), 20 + 1024)
  assert.ok(dropOrder([], 0) > 0)
})
