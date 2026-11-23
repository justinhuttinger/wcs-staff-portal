import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tasksByDue, rescheduleTo } from './calendar.js'

test('tasks land on their due date, urgent first; undated kept apart', () => {
  const { byDay, undated } = tasksByDue([
    { id: 'a', title: 'A', due_date: '2026-12-01', priority: 'low' },
    { id: 'b', title: 'B', due_date: '2026-12-01', priority: 'urgent' },
    { id: 'c', title: 'C', due_date: '2026-12-02', priority: 'medium' },
    { id: 'd', title: 'D', due_date: null, priority: 'high' },
  ])
  assert.deepEqual(byDay.get('2026-12-01').map(t => t.id), ['b', 'a'])
  assert.deepEqual(byDay.get('2026-12-02').map(t => t.id), ['c'])
  assert.deepEqual(undated.map(t => t.id), ['d'])
})

test('rescheduleTo: same day is no change; null clears the date', () => {
  assert.equal(rescheduleTo({ due_date: '2026-12-01' }, '2026-12-01'), undefined)
  assert.equal(rescheduleTo({ due_date: '2026-12-01' }, '2026-12-03'), '2026-12-03')
  assert.equal(rescheduleTo({ due_date: '2026-12-01' }, null), null)
  assert.equal(rescheduleTo({ due_date: null }, null), undefined)
})
