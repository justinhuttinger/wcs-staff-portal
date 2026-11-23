import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterTasks, sortTasks, groupByStatus, DEFAULT_FILTERS } from './model.js'

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
