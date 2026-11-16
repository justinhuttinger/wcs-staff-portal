import { test } from 'node:test'
import assert from 'node:assert/strict'
import { swapTicketsForHub } from './hubPin.js'

test('Tickets pin is replaced by Hub in the same spot', () => {
  assert.deepEqual(swapTicketsForHub(['app:abc', 'tool:ticketing', 'tool:memos']), ['app:abc', 'tool:hub', 'tool:memos'])
})

test('Hub already pinned: Tickets is just removed', () => {
  assert.deepEqual(swapTicketsForHub(['tool:hub', 'tool:ticketing']), ['tool:hub'])
})

test('No Tickets pin: Hub is added at the end when there is room', () => {
  assert.deepEqual(swapTicketsForHub(['app:abc']), ['app:abc', 'tool:hub'])
  const full = ['app:a', 'app:b', 'app:c', 'app:d', 'app:e']
  assert.deepEqual(swapTicketsForHub(full), full)
})
