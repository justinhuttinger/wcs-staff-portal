import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  itemLabels, volumeByMuscle, mergeVolume, volumeChips, formatRest, parseRest, programStatus,
} from './volume.js'

const bench = { primary_muscle: 'chest', secondary_muscles: ['triceps', 'shoulders'] }

test('labels match the server: per section, supersets numbered', () => {
  assert.deepEqual(itemLabels([
    { section: 'warmup' },
    { section: 'workout', superset_group: 'a' },
    { section: 'workout', superset_group: 'a' },
    { section: 'workout' },
  ]), ['A', 'A1', 'A2', 'B'])
})

test('volume: workout sets only, half to secondaries', () => {
  const v = volumeByMuscle([
    { section: 'workout', sets: 4, exercise: bench },
    { section: 'warmup', sets: 2, exercise: bench },
  ])
  assert.deepEqual(v, { chest: 4, triceps: 2, shoulders: 2 })
  assert.deepEqual(mergeVolume([v, { chest: 1 }]), { chest: 5, triceps: 2, shoulders: 2 })
  assert.equal(volumeChips(v)[0].muscle, 'chest')
})

test('rest round-trips between seconds and m:ss', () => {
  assert.equal(formatRest(90), '1:30')
  assert.equal(formatRest(45), '0:45')
  assert.equal(formatRest(null), '')
  assert.equal(parseRest('1:30'), 90)
  assert.equal(parseRest('90'), 90)
  assert.equal(parseRest('2m'), 120)
  assert.equal(parseRest('45s'), 45)
  assert.equal(parseRest(''), null)
  assert.equal(parseRest('soon'), null)
  assert.equal(parseRest('120:00'), 3600)
})

test('a future start is scheduled, not current', () => {
  const today = '2026-10-19'
  assert.equal(programStatus({ is_active: true, starts_on: '2026-11-02' }, today), 'scheduled')
  assert.equal(programStatus({ is_active: true, starts_on: '2026-10-19' }, today), 'current')
  assert.equal(programStatus({ is_active: true, starts_on: null }, today), 'current')
  assert.equal(programStatus({ is_active: true, ends_on: '2026-10-18' }, today), 'ended')
  assert.equal(programStatus({ is_active: false }, today), 'archived')
})
