const { test } = require('node:test')
const assert = require('node:assert/strict')
const { searchPattern, validateCustom, canEdit, createVideoResolver, VIDEO_CACHE_MS } = require('./exercisesHelpers')

test('search escapes LIKE wildcards and joins words loosely', () => {
  assert.equal(searchPattern('bench press'), '%bench%press%')
  assert.equal(searchPattern('100%_x'), '%100\\%\\_x%')
  assert.equal(searchPattern('a,b(c)'), '%a,b(c)%')
  assert.equal(searchPattern('   '), null)
  assert.equal(searchPattern(null), null)
})

test('a custom exercise needs a name and a known primary muscle', () => {
  assert.match(validateCustom({ name: '', primary_muscle: 'chest' }).error, /name/i)
  assert.match(validateCustom({ name: 'Landmine press', primary_muscle: 'pecs' }).error, /muscle/i)
  const ok = validateCustom({
    name: '  Landmine press ', primary_muscle: 'Shoulders', secondary_muscles: ['triceps', 'nonsense'],
    equipment: 'Barbell', instructions: ['Press up', ''], cues: ['Brace'],
  })
  assert.equal(ok.error, undefined)
  assert.equal(ok.row.name, 'Landmine press')
  assert.equal(ok.row.primary_muscle, 'shoulders')
  assert.deepEqual(ok.row.secondary_muscles, ['triceps'])
  assert.equal(ok.row.equipment, 'barbell')
  assert.deepEqual(ok.row.instructions, ['Press up'])
  assert.equal(ok.row.name_key, 'landmine press')
})

test('only custom rows are editable through the API', () => {
  assert.equal(canEdit({ source: 'custom' }), true)
  assert.equal(canEdit({ source: 'free' }), false)
  assert.equal(canEdit({ source: 'ymove' }), false)
})

test('video: 503 shape without a key for ymove rows', async () => {
  const resolve = createVideoResolver({ client: { isConfigured: () => false } })
  assert.equal(await resolve({ id: 'e1', source: 'ymove', source_id: 'y1' }), null)
})

test('video: free rows have none; custom rows with a video_url return it', async () => {
  const resolve = createVideoResolver({ client: { isConfigured: () => true } })
  assert.equal(await resolve({ id: 'e1', source: 'free', source_id: 'x' }), null)
  const v = await resolve({ id: 'e2', source: 'custom', video_url: 'https://wcs.example/v.mp4', thumbnail_url: 't.jpg' })
  assert.equal(v.videoUrl, 'https://wcs.example/v.mp4')
})

test('video cache reuses a fresh URL within 24h and refetches after', async () => {
  let calls = 0
  let clock = 0
  const client = { isConfigured: () => true, getExerciseVideo: async () => { calls += 1; return { videoUrl: `u${calls}` } } }
  const resolve = createVideoResolver({ client, now: () => clock })
  const row = { id: 'e1', source: 'ymove', source_id: 'y1' }
  assert.equal((await resolve(row)).videoUrl, 'u1')
  clock = VIDEO_CACHE_MS - 1
  assert.equal((await resolve(row)).videoUrl, 'u1')
  clock = VIDEO_CACHE_MS + 1
  assert.equal((await resolve(row)).videoUrl, 'u2')
  assert.equal(calls, 2)
  assert.ok(VIDEO_CACHE_MS <= 24 * 60 * 60 * 1000)
})
