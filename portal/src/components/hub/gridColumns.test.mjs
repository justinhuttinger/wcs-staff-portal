import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridColumns } from './gridColumns.js'

test('columns follow the task clubs; no clubs = one column', () => {
  assert.deepEqual(gridColumns(['salem', 'keizer'], []), [{ club: 'salem', removed: false }, { club: 'keizer', removed: false }])
  assert.deepEqual(gridColumns([], []), [{ club: null, removed: false }])
})

test('a filled slot outside the task clubs keeps its column, marked removed', () => {
  const dels = [{ slots: [{ club: null, items: [{ id: 'i1' }] }, { club: 'salem', items: [] }] }]
  assert.deepEqual(gridColumns(['salem', 'keizer'], dels), [
    { club: 'salem', removed: false }, { club: 'keizer', removed: false }, { club: null, removed: true },
  ])
})
