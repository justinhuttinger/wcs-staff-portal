import { test } from 'node:test'
import assert from 'node:assert/strict'

import { groupSets, topSet, compareToLast, chartGeometry, signed } from './logs.js'

const set = (exercise_id, set_number, weight, reps) => ({ exercise_id, exercise_name: exercise_id.toUpperCase(), set_number, weight, reps })

test('groupSets keeps logged order and sorts sets inside an exercise', () => {
  const g = groupSets([set('bench', 2, 100, 8), set('row', 1, 50, 10), set('bench', 1, 95, 10)])
  assert.deepEqual(g.map(x => x.exercise_id), ['bench', 'row'])
  assert.deepEqual(g[0].sets.map(s => s.set_number), [1, 2])
})

test('topSet: heaviest, most reps on a tie, reps only when nothing is weighted', () => {
  assert.deepEqual(topSet([set('a', 1, 100, 8), set('a', 2, 100, 10), set('a', 3, 90, 12)]), { weight: 100, reps: 10 })
  assert.deepEqual(topSet([set('a', 1, null, 12), set('a', 2, null, 15)]), { weight: null, reps: 15 })
  assert.deepEqual(topSet([set('a', 1, null, 20), set('a', 2, 10, 5)]), { weight: 10, reps: 5 })
  assert.equal(topSet([]), null)
})

test('compareToLast: each exercise against the next older session that had it', () => {
  const sessions = [
    { id: 's3', performed_on: '2026-10-15', sets: [set('bench', 1, 105, 8), set('squat', 1, 140, 5)] },
    { id: 's2', performed_on: '2026-10-12', sets: [set('row', 1, 60, 10)] },
    { id: 's1', performed_on: '2026-10-08', sets: [set('bench', 1, 100, 10)] },
  ]
  const c = compareToLast(sessions)
  assert.deepEqual(c.get('s3').get('bench'), { performed_on: '2026-10-08', weight: 100, reps: 10, dWeight: 5, dReps: -2 })
  assert.equal(c.get('s3').has('squat'), false)
  assert.equal(c.get('s1').size, 0)
})

test('chartGeometry scales into the box and skips nulls', () => {
  const g = chartGeometry([{ x: 'a', y: 100 }, { x: 'b', y: null }, { x: 'c', y: 120 }], { width: 200, height: 100, pad: 10 })
  assert.equal(g.dots.length, 2)
  assert.deepEqual(g.dots[0], { cx: 10, cy: 90, x: 'a', y: 100 })
  assert.deepEqual(g.dots[1], { cx: 190, cy: 10, x: 'c', y: 120 })
  assert.equal(g.path, 'M10,90 L190,10')
  assert.equal(chartGeometry([]).path, '')
  // One flat value still draws, centred.
  assert.equal(chartGeometry([{ x: 'a', y: 5 }], { width: 200, height: 100, pad: 10 }).dots[0].cx, 100)
})

test('signed', () => {
  assert.equal(signed(5, ' lb'), '+5 lb')
  assert.equal(signed(-2.5), '-2.5')
  assert.equal(signed(0), '0')
  assert.equal(signed(null), '')
})
