const test = require('node:test')
const assert = require('node:assert')
const { resolveExercises, templateTree } = require('./templateSeed')
const { nameKey } = require('./exerciseLibrary')

const lib = (id, name, source = 'free') => ({ id, name, name_key: nameKey(name), source })
const LIBRARY = [
  lib('e-goblet', 'Goblet Squat'),
  lib('e-machine', 'Machine Bench Press'),
  lib('e-old-custom', 'Hollow hold', 'custom'),
]

test('resolveExercises matches by name key, then alias, then custom', () => {
  const { byName, create, missing } = resolveExercises(
    ['Goblet squat', 'Chest press machine', 'Pike push-up', 'Hollow hold'],
    LIBRARY,
    {
      aliases: { 'Chest press machine': 'Machine Bench Press' },
      customs: { 'Pike push-up': { primary: 'shoulders', secondary: ['triceps'] }, 'Hollow hold': { primary: 'abdominals' } },
    },
  )
  assert.deepEqual(missing, [])
  assert.equal(byName.get('Goblet squat'), 'e-goblet')
  assert.equal(byName.get('Chest press machine'), 'e-machine')
  // Created on a previous run: reused, not created twice.
  assert.equal(byName.get('Hollow hold'), 'e-old-custom')
  assert.equal(byName.has('Pike push-up'), false)
  assert.equal(create.length, 1)
  assert.deepEqual(create[0], {
    source: 'custom', name: 'Pike push-up', name_key: nameKey('Pike push-up'),
    primary_muscle: 'shoulders', secondary_muscles: ['triceps'], equipment: null, created_by: 'seed',
  })
})

test('resolveExercises lists every name it cannot place, including a broken alias', () => {
  const { missing } = resolveExercises(['Mystery move', 'Chest press machine'], [], {
    aliases: { 'Chest press machine': 'Machine Bench Press' }, customs: {},
  })
  assert.equal(missing.length, 2)
  assert.match(missing[0], /Mystery move/)
  assert.match(missing[1], /Machine Bench Press/)
})

test('resolveExercises rejects a custom muscle outside the library vocabulary', () => {
  const { missing } = resolveExercises(['Odd'], [], { aliases: {}, customs: { Odd: { primary: 'hip flexors' } } })
  assert.equal(missing.length, 1)
})

test('templateTree turns a seed template into a builder tree', () => {
  const ids = new Map([['Goblet squat', 'e1'], ['Plank', 'e2'], ['Standing march', 'e3']])
  const tree = templateTree({
    name: 'T', goal: 'G', level: 'L', days_per_week: 1, equipment: 'Full gym', description: 'D', tags: ['a'],
    days: [{ name: 'Day A', ex: [
      { name: 'Standing march', sets: '2', reps: '20', weight: 'bodyweight', rest_seconds: 45, notes: null, section: 'warmup' },
      { name: 'Goblet squat', sets: '3', reps: '10', weight: '', rest_seconds: 90, notes: 'x' },
      { name: 'Plank', sets: '3', reps: '30 sec', weight: 'bodyweight', rest_seconds: 45, notes: null },
    ] }],
  }, ids)
  assert.equal(tree.name, 'T')
  assert.equal(tree.overview, 'D')
  assert.equal(tree.days.length, 1)
  const items = tree.days[0].items
  assert.deepEqual(items.map(i => i.section), ['warmup', 'workout', 'workout'])
  assert.deepEqual(items.map(i => i.exercise_id), ['e3', 'e1', 'e2'])
  assert.equal(items[1].sets, 3)
  assert.equal(items[1].weight, null)
})
