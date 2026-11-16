import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusOptions, canSubmitOnEnter } from './taskForm.js'

test('statusOptions offers Dropped so a task can be abandoned', () => {
  const values = statusOptions().map(o => o.value)
  assert.deepEqual(values, ['todo', 'waiting', 'done', 'dropped'])
})

test('canSubmitOnEnter refuses while a save is in flight', () => {
  assert.equal(canSubmitOnEnter({ key: 'Enter', title: 'Fix sign', saving: false }), true)
  assert.equal(canSubmitOnEnter({ key: 'Enter', title: 'Fix sign', saving: true }), false)
  assert.equal(canSubmitOnEnter({ key: 'Enter', title: '   ', saving: false }), false)
  assert.equal(canSubmitOnEnter({ key: 'a', title: 'x', saving: false }), false)
})
