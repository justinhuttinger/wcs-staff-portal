import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestionToTaskForm, ageLabel } from './suggestionForm.js'

test('email suggestion fills the editor and notes where it came from', () => {
  const f = suggestionToTaskForm({
    source: 'email', from_name: 'Alex Kim', summary: 'Sauna heater out', snippet: 'heater out',
    guess: { title: 'Fix sauna', description: 'Keizer heater down again', clubs: ['salem'], due_date: null, category_id: 'c1' },
  })
  assert.deepEqual([f.title, f.clubs, f.due_date, f.category_id, f.priority], ['Fix sauna', ['salem'], '', 'c1', 'medium'])
  assert.equal(f.description, 'Keizer heater down again\n\nFrom Alex Kim (email): "heater out"')
})

test('missing guess title falls back to the summary, then the subject', () => {
  assert.equal(suggestionToTaskForm({ source: 'email', summary: 'Approve Q1 schedule', guess: {} }).title, 'Approve Q1 schedule')
  assert.equal(suggestionToTaskForm({ source: 'email', subject: 'Hi', guess: null }).title, 'Hi')
})

test('ageLabel: minutes, hours, days', () => {
  const now = Date.parse('2026-11-16T12:00:00Z')
  assert.equal(ageLabel('2026-11-16T11:50:00Z', now), '10m')
  assert.equal(ageLabel('2026-11-16T09:00:00Z', now), '3h')
  assert.equal(ageLabel('2026-11-13T12:00:00Z', now), '3d')
})

test('text suggestion: notes it came by text; no person implied', () => {
  const f = suggestionToTaskForm({ source: 'text', from_name: 'Alex', summary: 'Approve Q1 schedule', snippet: 'need the Q1 schedule approved', guess: { phone: '+15035550100' } })
  assert.equal(f.title, 'Approve Q1 schedule')
  assert.equal(f.description, 'From Alex (text): "need the Q1 schedule approved"')
  assert.equal('phone' in f, false)
})
