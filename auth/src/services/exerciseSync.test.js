const test = require('node:test')
const assert = require('node:assert')
const { applyRows, syncYmove } = require('./exerciseSync')
const { listAllExercises } = require('./ymoveClient')
const { nameKey } = require('../lib/exerciseLibrary')

// Minimal stand-in for the supabase-js chain the sync uses:
// from(t).select(cols).range(a, b), from(t).insert(rows), from(t).upsert(rows, opts)
function fakeDb(existing = []) {
  const writes = []
  return {
    writes,
    from() {
      return {
        select() {
          return { range: async (a, b) => ({ data: existing.slice(a, b + 1), error: null }) }
        },
        insert: async (rows) => { writes.push({ op: 'insert', rows }); return { error: null } },
        upsert: async (rows, opts) => { writes.push({ op: 'upsert', rows, opts }); return { error: null } },
      }
    },
  }
}

const ymove = (id, title) => ({ id, title, slug: id, muscleGroup: 'Chest', secondaryMuscles: [], equipment: 'Dumbbell', hasVideo: true })

test('syncYmove skips without a key', async () => {
  const db = fakeDb()
  const client = { isConfigured: () => false, listAllExercises: async () => { throw new Error('should not fetch') } }
  assert.deepEqual(await syncYmove({ client, db }), { skipped: 'no_key' })
  assert.equal(db.writes.length, 0)
})

test('sync aborts without writes on fetch error', async () => {
  const db = fakeDb()
  const client = { isConfigured: () => true, listAllExercises: async () => { throw new Error('YMove 429') } }
  await assert.rejects(syncYmove({ client, db }), /429/)
  assert.equal(db.writes.length, 0)
})

test('sync links and inserts', async () => {
  const db = fakeDb([{ id: 'free-1', source: 'free', source_id: 'Dumbbell_Bench_Press', name_key: nameKey('Dumbbell Bench Press') }])
  const client = {
    isConfigured: () => true,
    listAllExercises: async () => [ymove('y1', 'DB Bench Press'), ymove('y2', 'Cable Fly')],
  }
  const result = await syncYmove({ client, db })
  assert.deepEqual(result, { inserted: 1, updated: 1, skipped: 0, total: 2 })
  const upsert = db.writes.find(w => w.op === 'upsert')
  assert.equal(upsert.rows[0].id, 'free-1')
  assert.equal(upsert.rows[0].source, 'ymove')
  assert.deepEqual(upsert.opts, { onConflict: 'id' })
})

test('applyRows reads every page of existing rows', async () => {
  const existing = Array.from({ length: 1500 }, (_, i) => ({ id: `id${i}`, source: 'free', source_id: `s${i}`, name_key: `k${i}` }))
  const db = fakeDb(existing)
  const rows = [{ source: 'free', source_id: 's1499', name_key: 'k1499', name: 'x' }]
  const result = await applyRows(rows, { db })
  assert.deepEqual(result, { inserted: 0, updated: 1, skipped: 0 })
})

test('listAllExercises pages until totalPages and never asks for video', async () => {
  process.env.YMOVE_API_KEY = 'ym_test'
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    const page = Number(new URL(url).searchParams.get('page'))
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [ymove(`y${page}`, `Move ${page}`)], pagination: { page, pageSize: 50, total: 2, totalPages: 2 } }),
    }
  }
  const all = await listAllExercises({ fetchImpl })
  delete process.env.YMOVE_API_KEY
  assert.equal(all.length, 2)
  assert.equal(calls.length, 2)
  for (const c of calls) {
    assert.equal(c.init.headers['X-API-Key'], 'ym_test')
    assert.equal(new URL(c.url).searchParams.get('excludeVideos'), '1')
  }
})

test('listAllExercises surfaces the status on failure', async () => {
  process.env.YMOVE_API_KEY = 'ym_test'
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ error: 'slow down', retryAfterMs: 5000 }) })
  await assert.rejects(listAllExercises({ fetchImpl }), /429/)
  delete process.env.YMOVE_API_KEY
})

test('listAllExercises keeps paging on full pages when totalPages is missing', async () => {
  process.env.YMOVE_API_KEY = 'ym_test'
  const full = Array.from({ length: 50 }, (_, i) => ymove(`a${i}`, `A ${i}`))
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get('page'))
    return { ok: true, status: 200, json: async () => ({ data: page === 1 ? full : [ymove('b1', 'B')] }) }
  }
  const all = await listAllExercises({ fetchImpl })
  delete process.env.YMOVE_API_KEY
  assert.equal(all.length, 51)
})

test('listAllExercises throws when the first page is empty (unknown response shape)', async () => {
  process.env.YMOVE_API_KEY = 'ym_test'
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) })
  await assert.rejects(listAllExercises({ fetchImpl }), /no exercises/i)
  delete process.env.YMOVE_API_KEY
})
