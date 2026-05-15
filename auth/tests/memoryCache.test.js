const test = require('node:test')
const assert = require('node:assert/strict')
const { wrap, wrapSWR, get, set, del } = require('../src/services/memoryCache')

// Helper: wait for a few microtasks + a real ms tick so background work settles.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Unique key per test so the shared module-level Map doesn't leak state.
let counter = 0
const k = (label) => `test:${label}:${++counter}:${process.hrtime.bigint()}`

test('wrap: returns cached value on hit and skips producer', async () => {
  const key = k('wrap-hit')
  let calls = 0
  const producer = async () => { calls++; return 'v1' }

  const a = await wrap(key, 1000, producer)
  const b = await wrap(key, 1000, producer)

  assert.equal(a, 'v1')
  assert.equal(b, 'v1')
  assert.equal(calls, 1, 'producer should only run once while cached')
})

test('wrapSWR: cold miss runs producer and caches result', async () => {
  const key = k('swr-miss')
  let calls = 0
  const producer = async () => { calls++; return { ok: true, n: calls } }

  const a = await wrapSWR(key, 100, 500, producer)
  assert.deepEqual(a, { ok: true, n: 1 })
  assert.equal(calls, 1)

  // Immediate second call is fresh → no producer invocation
  const b = await wrapSWR(key, 100, 500, producer)
  assert.deepEqual(b, { ok: true, n: 1 })
  assert.equal(calls, 1, 'fresh hit should not re-run producer')
})

test('wrapSWR: fresh window serves cached without refresh', async () => {
  const key = k('swr-fresh')
  let calls = 0
  const producer = async () => { calls++; return calls }

  await wrapSWR(key, 200, 500, producer)
  await sleep(50)
  const v = await wrapSWR(key, 200, 500, producer)

  assert.equal(v, 1)
  assert.equal(calls, 1)
})

test('wrapSWR: stale window returns old value AND triggers background refresh', async () => {
  const key = k('swr-stale')
  let calls = 0
  // Use a longer fresh window for the refreshed-entry assertion so the
  // 10ms producer + scheduling buffer doesn't push us past freshMs again.
  const producer = async () => { calls++; await sleep(10); return calls }

  await wrapSWR(key, 200, 2000, producer) // calls=1
  await sleep(220) // past freshMs=200, within staleMs=2000

  const v = await wrapSWR(key, 200, 2000, producer)
  assert.equal(v, 1, 'stale call returns the old cached value immediately')

  // Background refresh kicked off — wait for it to complete
  await sleep(40)
  assert.equal(calls, 2, 'background refresh should have run')

  // Next call within fresh window (refreshed ~40ms ago, fresh=200ms) returns new value
  const v2 = await wrapSWR(key, 200, 2000, producer)
  assert.equal(v2, 2)
  assert.equal(calls, 2)
})

test('wrapSWR: expired (past stale window) acts as miss and awaits producer', async () => {
  const key = k('swr-expired')
  let calls = 0
  const producer = async () => { calls++; return calls }

  await wrapSWR(key, 20, 30, producer) // calls=1, total life 50ms
  await sleep(80) // past freshMs+staleMs → entry should be gone

  const v = await wrapSWR(key, 20, 30, producer)
  assert.equal(v, 2, 'expired entry should force a synchronous re-fetch')
  assert.equal(calls, 2)
})

test('wrapSWR: singleflight — concurrent cold misses run producer exactly once', async () => {
  const key = k('swr-singleflight')
  let calls = 0
  const producer = async () => { calls++; await sleep(30); return calls }

  const [a, b, c] = await Promise.all([
    wrapSWR(key, 500, 1000, producer),
    wrapSWR(key, 500, 1000, producer),
    wrapSWR(key, 500, 1000, producer),
  ])

  assert.equal(a, 1)
  assert.equal(b, 1)
  assert.equal(c, 1)
  assert.equal(calls, 1, 'three concurrent misses should dedupe to one producer call')
})

test('wrapSWR: singleflight — concurrent stale-refresh requests dedupe to one bg fetch', async () => {
  const key = k('swr-singleflight-stale')
  let calls = 0
  const producer = async () => { calls++; await sleep(30); return calls }

  await wrapSWR(key, 30, 1000, producer) // calls=1
  await sleep(50) // now stale

  // Fire 5 concurrent stale reads — all should get old value, ONE bg refresh runs
  const results = await Promise.all([
    wrapSWR(key, 30, 1000, producer),
    wrapSWR(key, 30, 1000, producer),
    wrapSWR(key, 30, 1000, producer),
    wrapSWR(key, 30, 1000, producer),
    wrapSWR(key, 30, 1000, producer),
  ])
  assert.deepEqual(results, [1, 1, 1, 1, 1])

  await sleep(60) // wait for bg refresh
  assert.equal(calls, 2, 'only one background refresh despite 5 concurrent stale reads')
})

test('wrapSWR: producer error on stale keeps old value and does not crash caller', async () => {
  const key = k('swr-bg-error')
  let calls = 0
  const producer = async () => {
    calls++
    if (calls === 1) return 'good'
    throw new Error('upstream boom')
  }

  await wrapSWR(key, 30, 1000, producer) // calls=1, cached='good'
  await sleep(50) // stale

  // Stale read — returns old value, bg refresh will throw
  const v = await wrapSWR(key, 30, 1000, producer)
  assert.equal(v, 'good')

  await sleep(30) // let the failing bg refresh settle
  assert.equal(calls, 2, 'bg refresh was attempted')

  // Old value must still be served on subsequent stale reads (within staleMs window)
  const v2 = await wrapSWR(key, 30, 1000, producer)
  assert.equal(v2, 'good', 'failed bg refresh must NOT poison the cache')
})

test('wrapSWR: synchronous miss producer throws → caller sees the rejection', async () => {
  const key = k('swr-cold-error')
  const producer = async () => { throw new Error('cold fail') }

  await assert.rejects(
    wrapSWR(key, 100, 500, producer),
    /cold fail/,
    'cold miss with failing producer must reject'
  )

  // Cache should not retain a poisoned entry
  let calls = 0
  const next = async () => { calls++; return 'recovered' }
  const v = await wrapSWR(key, 100, 500, next)
  assert.equal(v, 'recovered')
  assert.equal(calls, 1)
})

test('wrapSWR: distinct keys do not collide', async () => {
  const k1 = k('swr-key-a')
  const k2 = k('swr-key-b')

  const a = await wrapSWR(k1, 1000, 5000, async () => 'A')
  const b = await wrapSWR(k2, 1000, 5000, async () => 'B')

  assert.equal(a, 'A')
  assert.equal(b, 'B')
})

test('del: clears entries written via wrap/wrapSWR', async () => {
  const key = k('del')
  let calls = 0
  await wrapSWR(key, 1000, 5000, async () => { calls++; return calls })
  del(key)
  await wrapSWR(key, 1000, 5000, async () => { calls++; return calls })
  assert.equal(calls, 2, 'del should force the next call to re-fetch')
})
