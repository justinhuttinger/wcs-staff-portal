const test = require('node:test')
const assert = require('node:assert')
const {
  SECTIONS, normaliseTree, planTreeDiff, itemLabels, volumeByMuscle, mergeVolume, copyTree,
} = require('./coachingPrograms')

const EX = {
  bench: 'aaaaaaaa-0000-4000-8000-000000000001',
  row: 'aaaaaaaa-0000-4000-8000-000000000002',
  squat: 'aaaaaaaa-0000-4000-8000-000000000003',
  bike: 'aaaaaaaa-0000-4000-8000-000000000004',
}

const item = (over = {}) => ({ section: 'workout', exercise_id: EX.bench, sets: 3, reps: '8-12', ...over })

test('SECTIONS are warm up, workout, cool down in that order', () => {
  assert.deepEqual(SECTIONS, ['warmup', 'workout', 'cooldown'])
})

test('normaliseTree requires a program name', () => {
  assert.ok(normaliseTree({ name: '  ' }).error)
  assert.ok(normaliseTree({}).error)
})

test('normaliseTree trims and clamps program fields', () => {
  const { tree, error } = normaliseTree({
    name: `  ${'x'.repeat(200)} `,
    overview: 'o'.repeat(3000),
    tags: [' Strength ', '', 'y'.repeat(60), ...Array.from({ length: 20 }, (_, i) => `t${i}`)],
    goal: ' Hypertrophy ', level: 'Beginner', equipment: 'Full gym',
    days_per_week: 9, starts_on: '2026-11-02', ends_on: 'not a date',
  })
  assert.equal(error, undefined)
  assert.equal(tree.program.name.length, 120)
  assert.equal(tree.program.overview.length, 2000)
  assert.equal(tree.program.tags.length, 12)
  assert.equal(tree.program.tags[0], 'Strength')
  assert.equal(tree.program.tags[1].length, 40)
  assert.equal(tree.program.goal, 'Hypertrophy')
  assert.equal(tree.program.days_per_week, null)
  assert.equal(tree.program.starts_on, '2026-11-02')
  assert.equal(tree.program.ends_on, null)
  assert.deepEqual(tree.days, [])
})

test('normaliseTree accepts days_per_week 1-7 and rejects an end before the start', () => {
  assert.equal(normaliseTree({ name: 'P', days_per_week: '4' }).tree.program.days_per_week, 4)
  assert.ok(normaliseTree({ name: 'P', starts_on: '2026-11-10', ends_on: '2026-11-01' }).error)
})

test('normaliseTree positions days and items by array order and cleans items', () => {
  const { tree } = normaliseTree({
    name: 'P',
    days: [
      { id: 'd1', name: ' Push ', instructions: 'Go', items: [
        item({ id: 'i1', section: 'nonsense', sets: 50, rest_seconds: 99999, reps: ' 10 ', superset_group: 'ABCDEFG' }),
        { section: 'warmup', sets: 2 }, // no exercise: dropped
        item({ section: 'cooldown', exercise_id: EX.bike, sets: '', rest_seconds: '', notes: 'n'.repeat(500) }),
      ] },
      { name: '', items: [] },
    ],
  })
  assert.equal(tree.days.length, 2)
  const [d1, d2] = tree.days
  assert.equal(d1.id, 'd1')
  assert.equal(d1.name, 'Push')
  assert.equal(d1.position, 0)
  assert.equal(d2.position, 1)
  assert.equal(d2.name, 'Day 2')
  assert.equal(d1.items.length, 2)
  const [a, b] = d1.items
  assert.equal(a.id, 'i1')
  assert.equal(a.section, 'workout')
  assert.equal(a.sets, 20)
  assert.equal(a.rest_seconds, 3600)
  assert.equal(a.reps, '10')
  assert.equal(a.superset_group, 'ABCD')
  assert.equal(a.position, 0)
  assert.equal(b.position, 1)
  assert.equal(b.sets, null)
  assert.equal(b.rest_seconds, null)
  assert.equal(b.notes.length, 400)
})

test('normaliseTree drops items whose exercise_id is not a uuid and caps counts', () => {
  const many = Array.from({ length: 60 }, () => item())
  const { tree } = normaliseTree({
    name: 'P',
    days: Array.from({ length: 20 }, () => ({ name: 'D', items: [item({ exercise_id: 'bench' }), ...many] })),
  })
  assert.equal(tree.days.length, 14)
  assert.equal(tree.days[0].items.length, 40)
  assert.ok(tree.days[0].items.every(i => i.exercise_id === EX.bench))
})

const STORED = {
  days: [
    { id: 'd1', items: [{ id: 'i1' }, { id: 'i2' }] },
    { id: 'd2', items: [{ id: 'i3' }] },
  ],
}

function treeOf(days) {
  return normaliseTree({ name: 'P', days }).tree
}

test('planTreeDiff keeps the ids of unchanged days and items', () => {
  const plan = planTreeDiff(STORED, treeOf([
    { id: 'd1', name: 'A', items: [item({ id: 'i1' }), item({ id: 'i2' })] },
    { id: 'd2', name: 'B', items: [item({ id: 'i3' })] },
  ]))
  assert.deepEqual(plan.days.insert, [])
  assert.deepEqual(plan.days.delete, [])
  assert.deepEqual(plan.days.update.map(u => u.id), ['d1', 'd2'])
  assert.deepEqual(plan.items.insert, [])
  assert.deepEqual(plan.items.delete, [])
  assert.deepEqual(plan.items.update.map(u => u.id), ['i1', 'i2', 'i3'])
  assert.equal(plan.items.update[0].row.day_id, 'd1')
  assert.equal(plan.items.update[2].row.day_id, 'd2')
})

test('planTreeDiff deletes only the removed item', () => {
  const plan = planTreeDiff(STORED, treeOf([
    { id: 'd1', name: 'A', items: [item({ id: 'i2' })] },
    { id: 'd2', name: 'B', items: [item({ id: 'i3' })] },
  ]))
  assert.deepEqual(plan.items.delete, ['i1'])
  assert.deepEqual(plan.days.delete, [])
  assert.equal(plan.items.update.find(u => u.id === 'i2').row.position, 0)
})

test('planTreeDiff treats foreign or unknown ids as new rows', () => {
  const plan = planTreeDiff(STORED, treeOf([
    { id: 'd1', name: 'A', items: [item({ id: 'i1' }), item({ id: 'i2' }), item({ id: 'other-program-item' })] },
    { id: 'other-program-day', name: 'X', items: [item({ id: 'i3' })] },
  ]))
  assert.deepEqual(plan.days.delete, ['d2'])
  assert.equal(plan.days.insert.length, 1)
  assert.equal(plan.days.insert[0].day_index, 1)
  assert.equal(plan.days.insert[0].row.id, undefined)
  assert.ok(!plan.days.update.some(u => u.id === 'other-program-day'))
  const foreign = plan.items.insert.find(i => i.day_id === 'd1')
  assert.ok(foreign)
  assert.equal(foreign.row.id, undefined)
  assert.ok(!plan.items.update.some(u => u.id === 'other-program-item'))
  // i3 is ours and moves onto the new day.
  const moved = plan.items.update.find(u => u.id === 'i3')
  assert.equal(moved.row.day_id, undefined)
  assert.equal(moved.day_index, 1)
})

test('planTreeDiff moves an item between days as an update with the new day', () => {
  const plan = planTreeDiff(STORED, treeOf([
    { id: 'd1', name: 'A', items: [item({ id: 'i1' })] },
    { id: 'd2', name: 'B', items: [item({ id: 'i3' }), item({ id: 'i2' })] },
  ]))
  assert.deepEqual(plan.items.delete, [])
  assert.deepEqual(plan.items.insert, [])
  const moved = plan.items.update.find(u => u.id === 'i2')
  assert.equal(moved.row.day_id, 'd2')
  assert.equal(moved.row.position, 1)
})

test('planTreeDiff: a new day with new items references the day by index', () => {
  const plan = planTreeDiff(STORED, treeOf([
    { id: 'd1', name: 'A', items: [item({ id: 'i1' }), item({ id: 'i2' })] },
    { id: 'd2', name: 'B', items: [item({ id: 'i3' })] },
    { name: 'C', items: [item(), item({ exercise_id: EX.row })] },
  ]))
  assert.equal(plan.days.insert.length, 1)
  assert.equal(plan.days.insert[0].day_index, 2)
  assert.equal(plan.days.insert[0].row.position, 2)
  assert.equal(plan.items.insert.length, 2)
  assert.ok(plan.items.insert.every(i => i.day_index === 2 && i.day_id === undefined))
  assert.equal(plan.items.insert[1].row.exercise_id, EX.row)
})

test('planTreeDiff: an id used twice in one tree only keeps the row once', () => {
  const plan = planTreeDiff(STORED, treeOf([
    { id: 'd1', name: 'A', items: [item({ id: 'i1' }), item({ id: 'i1' })] },
  ]))
  assert.equal(plan.items.update.filter(u => u.id === 'i1').length, 1)
  assert.equal(plan.items.insert.length, 1)
  assert.deepEqual(plan.days.delete, ['d2'])
  assert.deepEqual(plan.items.delete.sort(), ['i2', 'i3'])
})

test('planTreeDiff against nothing stored inserts the whole tree', () => {
  const plan = planTreeDiff({ days: [] }, treeOf([{ id: 'd1', name: 'A', items: [item({ id: 'i1' })] }]))
  assert.equal(plan.days.insert.length, 1)
  assert.equal(plan.items.insert.length, 1)
  assert.equal(plan.items.insert[0].day_index, 0)
})

test('itemLabels: A, B, C per section, supersets share a letter', () => {
  const labels = itemLabels([
    { section: 'warmup' },
    { section: 'workout', superset_group: 's1' },
    { section: 'workout', superset_group: 's1' },
    { section: 'workout' },
    { section: 'workout', superset_group: 's2' },
    { section: 'workout', superset_group: 's2' },
    { section: 'workout', superset_group: 's2' },
    { section: 'workout', superset_group: 'lonely' },
    { section: 'cooldown' },
  ])
  assert.deepEqual(labels, ['A', 'A1', 'A2', 'B', 'C1', 'C2', 'C3', 'D', 'A'])
})

test('itemLabels: the same group split by another item is two letters', () => {
  assert.deepEqual(
    itemLabels([{ section: 'workout', superset_group: 'x' }, { section: 'workout' }, { section: 'workout', superset_group: 'x' }]),
    ['A', 'B', 'C'],
  )
})

const LIB = {
  [EX.bench]: { primary_muscle: 'chest', secondary_muscles: ['triceps', 'shoulders'] },
  [EX.squat]: { primary_muscle: 'quadriceps', secondary_muscles: ['glutes'] },
  [EX.bike]: { primary_muscle: 'quadriceps', secondary_muscles: [] },
}

test('volumeByMuscle: 1 set to the primary, half to each secondary', () => {
  assert.deepEqual(volumeByMuscle([item({ sets: 4 })], LIB), { chest: 4, triceps: 2, shoulders: 2 })
})

test('volumeByMuscle ignores warm up and cool down, and null sets', () => {
  const v = volumeByMuscle([
    item({ section: 'warmup', exercise_id: EX.bike, sets: 3 }),
    item({ exercise_id: EX.squat, sets: 3 }),
    item({ exercise_id: EX.squat, sets: null }),
    item({ section: 'cooldown', sets: 2 }),
    item({ exercise_id: 'unknown', sets: 5 }),
  ], new Map(Object.entries(LIB)))
  assert.deepEqual(v, { quadriceps: 3, glutes: 1.5 })
})

test('mergeVolume sums days into a program total', () => {
  assert.deepEqual(mergeVolume([{ chest: 4, triceps: 2 }, { chest: 3, quadriceps: 3 }]), { chest: 7, triceps: 2, quadriceps: 3 })
})

test('copyTree strips every id and leaves the source alone', () => {
  const tree = treeOf([{ id: 'd1', name: 'A', items: [item({ id: 'i1' })] }])
  const copy = copyTree(tree)
  assert.equal(copy.days[0].id, undefined)
  assert.equal(copy.days[0].items[0].id, undefined)
  assert.equal(copy.days[0].items[0].exercise_id, EX.bench)
  assert.equal(tree.days[0].id, 'd1')
  copy.days[0].items[0].sets = 99
  assert.equal(tree.days[0].items[0].sets, 3)
})
