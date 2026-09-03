const test = require('node:test')
const assert = require('node:assert/strict')

const { HABIT_PRESETS, normaliseHabit, shiftDay } = require('./habits')

test('preset owns its label and unit, the caller only picks the level', () => {
  const { value } = normaliseHabit({ kind: 'water', target: 128, label: 'Beer', unit: 'pints' })
  assert.deepEqual(value, { kind: 'water', label: 'Water', unit: 'oz', target: 128 })
})

test('a preset with no target falls back to its default', () => {
  assert.equal(normaliseHabit({ kind: 'steps' }).value.target, 10000)
})

test('a level that is not a positive number is refused', () => {
  assert.ok(normaliseHabit({ kind: 'sleep', target: 0 }).error)
  assert.ok(normaliseHabit({ kind: 'sleep', target: 'plenty' }).error)
})

test('an unknown kind is refused rather than treated as custom', () => {
  assert.ok(normaliseHabit({ kind: 'sauna' }).error)
})

test('a custom habit needs a name', () => {
  assert.ok(normaliseHabit({ kind: 'custom', label: '   ' }).error)
})

test('a custom habit can be a plain yes or no', () => {
  const { value } = normaliseHabit({ kind: 'custom', label: 'No soda' })
  assert.deepEqual(value, { kind: 'custom', label: 'No soda', unit: null, target: null })
})

test('editing keeps the level when only the label is sent', () => {
  const { value } = normaliseHabit({ label: 'ignored' }, { kind: 'water', target: 64 })
  assert.equal(value.target, 64)
})

test('a long custom name is trimmed to the width the tile can hold', () => {
  const { value } = normaliseHabit({ kind: 'custom', label: 'x'.repeat(80) })
  assert.equal(value.label.length, 40)
})

// The member app ships its own copy of these in worker/habits.js. If one side
// changes a unit or a level, the two deployments disagree about the same table.
test('presets are the three the member app knows, with their units', () => {
  assert.deepEqual(HABIT_PRESETS.map(p => [p.kind, p.unit]),
    [['water', 'oz'], ['sleep', 'hours'], ['steps', 'steps']])
  for (const p of HABIT_PRESETS) {
    assert.ok(p.levels.includes(p.target), `${p.kind} default must be one of its levels`)
  }
})

test('shiftDay walks backwards across a month boundary', () => {
  assert.equal(shiftDay('2026-10-01', -1), '2026-09-30')
  assert.equal(shiftDay('2026-11-02', -30), '2026-10-03')
})
