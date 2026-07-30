// Proves the mechanism that makes a portal-created class show on the public
// board immediately, without touching ABC or the live calendar.
const test = require('node:test')
const assert = require('node:assert')
const cache = require('../services/memoryCache')
const { publicCacheKeysForDates } = require('./groupXPublic')

const FRESH = 2 * 60 * 1000
const STALE = 60 * 60 * 1000

test('invalidating a week forces the next board read to refetch', async () => {
  const key = publicCacheKeysForDates('30935', ['2026-08-01'])[0]
  assert.strictEqual(key, 'gx:public:30935:2026-07-27')

  let fetches = 0
  const producer = async () => { fetches++; return { classes: fetches } }

  // First read populates the cache.
  await cache.wrapSWR(key, FRESH, STALE, producer)
  assert.strictEqual(fetches, 1)

  // Within the fresh window a second read is served from cache — this is the
  // staleness a newly created class would otherwise be stuck behind.
  await cache.wrapSWR(key, FRESH, STALE, producer)
  assert.strictEqual(fetches, 1, 'served from cache while fresh')

  // A write clears the week, so the next read is a cold miss and refetches.
  for (const k of publicCacheKeysForDates('30935', ['2026-08-01'])) cache.del(k)
  const after = await cache.wrapSWR(key, FRESH, STALE, producer)
  assert.strictEqual(fetches, 2, 'refetched after invalidation')
  assert.deepStrictEqual(after, { classes: 2 })
})

test('invalidating one week does not clear another', async () => {
  // Different club from the test above so the two tests cannot share cache
  // state — memoryCache is module-level and persists across tests.
  const [wk1] = publicCacheKeysForDates('31599', ['2026-08-01']) // week of Jul 27
  const [wk2] = publicCacheKeysForDates('31599', ['2026-08-10']) // week of Aug 10
  assert.notStrictEqual(wk1, wk2)
  cache.del(wk1); cache.del(wk2)

  let a = 0, b = 0
  await cache.wrapSWR(wk1, FRESH, STALE, async () => { a++; return 'a' })
  await cache.wrapSWR(wk2, FRESH, STALE, async () => { b++; return 'b' })

  for (const k of publicCacheKeysForDates('31599', ['2026-08-01'])) cache.del(k)

  await cache.wrapSWR(wk1, FRESH, STALE, async () => { a++; return 'a' })
  await cache.wrapSWR(wk2, FRESH, STALE, async () => { b++; return 'b' })
  assert.strictEqual(a, 2, 'cleared week refetched')
  assert.strictEqual(b, 1, 'untouched week still cached')
})
