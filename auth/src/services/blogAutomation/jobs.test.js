// jobs.js imports ../supabase, which calls createClient at module load. Satisfy it
// so the module imports under Node < 22 (no native WebSocket); the fake db injected
// into sweepStale means the real client is never actually used.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'
if (!globalThis.WebSocket) globalThis.WebSocket = class {}

const test = require('node:test')
const assert = require('node:assert')
const jobs = require('./jobs')

// Minimal chainable fake of the supabase-js query builder that records the
// update patch and the filters applied, then resolves like .select() does.
function fakeDb(returnRows = [{ id: 'a' }, { id: 'b' }]) {
  const calls = { table: null, update: null, filters: [] }
  const qb = {
    from(t) { calls.table = t; return qb },
    update(patch) { calls.update = patch; return qb },
    eq(col, val) { calls.filters.push(['eq', col, val]); return qb },
    is(col, val) { calls.filters.push(['is', col, val]); return qb },
    lt(col, val) { calls.filters.push(['lt', col, val]); return qb },
    select() { return Promise.resolve({ data: returnRows, error: null }) },
  }
  return { qb, calls }
}

test('sweepStale marks failed but only generating rows with a NULL error_message', async () => {
  const { qb, calls } = fakeDb()
  const swept = await jobs.sweepStale(15, { supabase: qb })

  assert.equal(calls.update.status, 'failed')
  // Must scope to in-flight orphans, NOT successful dry runs (which carry a message).
  assert.deepEqual(calls.filters.find(f => f[0] === 'eq' && f[1] === 'status'), ['eq', 'status', 'generating'])
  assert.deepEqual(calls.filters.find(f => f[0] === 'is'), ['is', 'error_message', null])
  // And only old rows.
  assert.ok(calls.filters.some(f => f[0] === 'lt' && f[1] === 'created_at'))
  assert.equal(swept.length, 2)
})

test('sweepStale returns [] when nothing is stale', async () => {
  const { qb } = fakeDb([])
  assert.deepEqual(await jobs.sweepStale(15, { supabase: qb }), [])
})

test('sweepStale throws on a db error', async () => {
  const qb = {
    from() { return qb }, update() { return qb }, eq() { return qb }, is() { return qb }, lt() { return qb },
    select() { return Promise.resolve({ data: null, error: { message: 'boom' } }) },
  }
  await assert.rejects(() => jobs.sweepStale(15, { supabase: qb }), /sweepStale failed: boom/)
})
