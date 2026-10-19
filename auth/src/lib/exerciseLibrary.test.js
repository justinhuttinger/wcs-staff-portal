const test = require('node:test')
const assert = require('node:assert')
const { MUSCLES, nameKey, fromFreeDb, fromYmove, planUpsert } = require('./exerciseLibrary')

const SHA = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5'

const SIT_UP = {
  name: '3/4 Sit-Up', force: 'pull', level: 'beginner', mechanic: 'compound',
  equipment: 'body only', primaryMuscles: ['abdominals'], secondaryMuscles: [],
  instructions: ['Lie down on the floor and secure your feet.'],
  category: 'strength', images: ['3_4_Sit-Up/0.jpg', '3_4_Sit-Up/1.jpg'], id: '3_4_Sit-Up',
}

const YM_BENCH = {
  id: 'b1a7f0de-0000-4000-8000-000000000001', title: 'DB Bench Press', slug: 'db-bench-press',
  muscleGroup: 'Chest', secondaryMuscles: ['Triceps', 'Shoulders'], equipment: 'Dumbbell',
  category: 'compound', difficulty: 'beginner', instructions: ['Press up.'],
  importantPoints: ['Keep shoulders down.'], thumbnailUrl: 'https://cdn.example/t.jpg', hasVideo: true,
}

test('MUSCLES is the 17-name free-exercise-db vocabulary', () => {
  assert.equal(MUSCLES.length, 17)
  assert.ok(MUSCLES.includes('middle back'))
  assert.ok(MUSCLES.includes('quadriceps'))
})

test('nameKey folds case, punctuation and common abbreviations', () => {
  assert.equal(nameKey('DB Bench Press'), nameKey('Dumbbell bench press'))
  assert.equal(nameKey('E-Z Curl Bar Curls'), nameKey('ez bar curl'))
  assert.equal(nameKey('  Pull-Up '), 'pull up')
  assert.equal(nameKey('KB Swing'), nameKey('Kettlebell swings'))
  assert.equal(nameKey('Rock & Roll'), 'rock and roll')
})

test('fromFreeDb maps a free-exercise-db row onto a library row', () => {
  const row = fromFreeDb(SIT_UP, SHA)
  assert.equal(row.source, 'free')
  assert.equal(row.source_id, '3_4_Sit-Up')
  assert.equal(row.name, '3/4 Sit-Up')
  assert.equal(row.name_key, nameKey('3/4 Sit-Up'))
  assert.equal(row.primary_muscle, 'abdominals')
  assert.deepEqual(row.secondary_muscles, [])
  assert.equal(row.difficulty, 'beginner')
  assert.equal(row.has_video, false)
  assert.ok(row.thumbnail_url.includes(SHA))
  assert.ok(row.thumbnail_url.endsWith('/exercises/3_4_Sit-Up/0.jpg'))
})

test('fromFreeDb keeps extra primary muscles as secondaries and tolerates no images', () => {
  const row = fromFreeDb({ ...SIT_UP, primaryMuscles: ['quadriceps', 'glutes'], secondaryMuscles: ['calves'], images: [] }, SHA)
  assert.equal(row.primary_muscle, 'quadriceps')
  assert.deepEqual(row.secondary_muscles, ['glutes', 'calves'])
  assert.equal(row.thumbnail_url, null)
})

test('fromYmove maps title, cues and lowercases muscles', () => {
  const row = fromYmove(YM_BENCH)
  assert.equal(row.source, 'ymove')
  assert.equal(row.source_id, YM_BENCH.id)
  assert.equal(row.name, 'DB Bench Press')
  assert.equal(row.primary_muscle, 'chest')
  assert.deepEqual(row.secondary_muscles, ['triceps', 'shoulders'])
  assert.equal(row.equipment, 'dumbbell')
  assert.deepEqual(row.cues, ['Keep shoulders down.'])
  assert.equal(row.has_video, true)
})

test('upsert plan is idempotent', () => {
  const incoming = [fromFreeDb(SIT_UP, SHA)]
  const existing = [{ id: 'x1', source: 'free', source_id: '3_4_Sit-Up', name_key: incoming[0].name_key }]
  const plan = planUpsert(existing, incoming)
  assert.equal(plan.inserts.length, 0)
  assert.deepEqual(plan.updates.map(u => u.id), ['x1'])
})

test('ymove links onto a free row by name_key', () => {
  const existing = [{ id: 'free-1', source: 'free', source_id: 'Dumbbell_Bench_Press', name_key: nameKey('Dumbbell Bench Press') }]
  const plan = planUpsert(existing, [fromYmove(YM_BENCH)])
  assert.equal(plan.inserts.length, 0)
  assert.equal(plan.updates.length, 1)
  assert.equal(plan.updates[0].id, 'free-1')
  assert.equal(plan.updates[0].row.source, 'ymove')
  assert.equal(plan.updates[0].row.source_id, YM_BENCH.id)
})

test('two ymove rows with the same name_key link only one; the other inserts', () => {
  const existing = [{ id: 'free-1', source: 'free', source_id: 'Dumbbell_Bench_Press', name_key: nameKey('Dumbbell Bench Press') }]
  const second = fromYmove({ ...YM_BENCH, id: 'b1a7f0de-0000-4000-8000-000000000002', title: 'Dumbbell Bench Press' })
  const plan = planUpsert(existing, [fromYmove(YM_BENCH), second])
  assert.equal(plan.updates.length, 1)
  assert.equal(plan.inserts.length, 1)
  assert.equal(plan.inserts[0].source_id, second.source_id)
})

test('a ymove row already linked is updated by source_id, not re-linked', () => {
  const existing = [{ id: 'free-1', source: 'ymove', source_id: YM_BENCH.id, name_key: nameKey('DB Bench Press') }]
  const plan = planUpsert(existing, [fromYmove(YM_BENCH)])
  assert.deepEqual(plan.updates.map(u => u.id), ['free-1'])
  assert.equal(plan.inserts.length, 0)
})

test('custom rows are never matched', () => {
  const existing = [{ id: 'c1', source: 'custom', source_id: null, name_key: nameKey('DB Bench Press') }]
  const plan = planUpsert(existing, [fromYmove(YM_BENCH)])
  assert.equal(plan.updates.length, 0)
  assert.equal(plan.inserts.length, 1)
})

test('re-seeding free data after YMove linked a row neither duplicates nor overwrites it', () => {
  // The free row was linked (source flipped to ymove), so its free source_id
  // no longer exists. Its name does; that is what keeps the seed idempotent.
  const existing = [{ id: 'y1', source: 'ymove', source_id: 'abc', name_key: nameKey('3/4 Sit-Up') }]
  const plan = planUpsert(existing, [fromFreeDb(SIT_UP, SHA)])
  assert.equal(plan.updates.length, 0)
  assert.equal(plan.inserts.length, 0)
  assert.equal(plan.skipped, 1)
})

test('a free row with a name nobody has is inserted', () => {
  const plan = planUpsert([], [fromFreeDb(SIT_UP, SHA)])
  assert.equal(plan.inserts.length, 1)
  assert.equal(plan.skipped, 0)
})
