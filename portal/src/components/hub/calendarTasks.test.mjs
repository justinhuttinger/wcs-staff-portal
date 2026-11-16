import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tasksByDay } from './calendarTasks.js'

const tasks = [
  { id: 'a', due_date: '2026-11-20', priority: 'low', title: 'A' },
  { id: 'b', due_date: '2026-11-20', priority: 'high', title: 'B' },
  { id: 'c', due_date: '2026-12-02', priority: 'medium', title: 'C' },
  { id: 'd', due_date: null, priority: 'high', title: 'D' },
]

test('tasks land on their due date, high priority first', () => {
  const { byDay } = tasksByDay(tasks)
  assert.deepEqual(byDay.get('2026-11-20').map(t => t.id), ['b', 'a'])
  assert.deepEqual(byDay.get('2026-12-02').map(t => t.id), ['c'])
})

test('tasks without a due date are listed separately', () => {
  assert.deepEqual(tasksByDay(tasks).undated.map(t => t.id), ['d'])
})
