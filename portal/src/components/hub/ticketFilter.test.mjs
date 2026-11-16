import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openTicketsFirst, LIVE_STATUSES } from './ticketFilter.js'

test('only tickets being worked (open, in progress), most recently touched first', () => {
  const rows = [
    { id: 1, status: 'open', updated_at: '2026-11-10T00:00:00Z' },
    { id: 2, status: 'closed', updated_at: '2026-11-15T00:00:00Z' },
    { id: 3, status: 'in_progress', updated_at: '2026-11-14T00:00:00Z' },
    { id: 4, status: 'complete', updated_at: '2026-11-16T00:00:00Z' },
    { id: 5, status: 'open', created_at: '2026-11-12T00:00:00Z' },
  ]
  assert.deepEqual(openTicketsFirst(rows).map(t => t.id), [3, 5, 1])
})

test('the statuses fetched one by one are exactly the ones kept', () => {
  assert.deepEqual(LIVE_STATUSES, ['open', 'in_progress'])
})

test('a ticket returned by two status calls is shown once', () => {
  const t = { id: 7, status: 'open', updated_at: '2026-11-10T00:00:00Z' }
  assert.equal(openTicketsFirst([t, { ...t }]).length, 1)
})
