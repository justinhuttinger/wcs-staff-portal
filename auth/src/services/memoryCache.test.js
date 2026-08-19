const test = require('node:test')
const assert = require('node:assert')
const memoryCache = require('./memoryCache')

// Each test clears the shared module-scope store first so tests don't leak
// into each other (memoryCache is a singleton, same as in production).
function clearStore() {
  memoryCache._store.clear()
}

test('set()/get() round-trip within TTL', () => {
  clearStore()
  memoryCache.set('k1', 'v1', 1000)
  assert.strictEqual(memoryCache.get('k1'), 'v1')
})

test('get() evicts and returns undefined once expired', () => {
  clearStore()
  memoryCache.set('k1', 'v1', -1) // already expired
  assert.strictEqual(memoryCache.get('k1'), undefined)
  assert.strictEqual(memoryCache._store.has('k1'), false)
})

test('sweepExpired removes expired entries even without a read', () => {
  clearStore()
  memoryCache.set('expired', 'v', -1)
  memoryCache.set('fresh', 'v', 60_000)
  assert.strictEqual(memoryCache._store.size, 2)
  memoryCache.sweepExpired()
  assert.strictEqual(memoryCache._store.has('expired'), false)
  assert.strictEqual(memoryCache._store.has('fresh'), true)
  assert.strictEqual(memoryCache._store.size, 1)
})

test('set() enforces MAX_ENTRIES and evicts oldest-first on overflow', () => {
  clearStore()
  const cap = memoryCache.MAX_ENTRIES
  // Fill to exactly the cap.
  for (let i = 0; i < cap; i++) {
    memoryCache.set(`key-${i}`, i, 60_000)
  }
  assert.strictEqual(memoryCache._store.size, cap)
  assert.strictEqual(memoryCache.get('key-0'), 0, 'oldest entry should still be present at exactly the cap')

  // One more insert must evict the oldest (key-0) to stay at/under the cap.
  memoryCache.set('key-overflow', 'x', 60_000)
  assert.ok(memoryCache._store.size <= cap, 'store size must not exceed the cap')
  assert.strictEqual(memoryCache.get('key-0'), undefined, 'oldest entry must be evicted first')
  assert.strictEqual(memoryCache.get('key-1'), 1, 'second-oldest entry should survive one overflow insert')
  assert.strictEqual(memoryCache.get('key-overflow'), 'x')
})

test('set() overwriting an existing key does not count as growth and does not trigger eviction', () => {
  clearStore()
  memoryCache.set('a', 1, 60_000)
  memoryCache.set('b', 2, 60_000)
  memoryCache.set('a', 'updated', 60_000) // overwrite, not a new key
  assert.strictEqual(memoryCache._store.size, 2)
  assert.strictEqual(memoryCache.get('a'), 'updated')
  assert.strictEqual(memoryCache.get('b'), 2)
})

test('getStats().evictions increments when the cap is exceeded', () => {
  clearStore()
  memoryCache.resetStats()
  const cap = memoryCache.MAX_ENTRIES
  for (let i = 0; i < cap; i++) memoryCache.set(`k-${i}`, i, 60_000)
  const before = memoryCache.getStats().evictions
  memoryCache.set('one-more', 1, 60_000)
  const after = memoryCache.getStats().evictions
  assert.strictEqual(after, before + 1)
})

test('wrap() populated entries are subject to the same cap/eviction path', async () => {
  clearStore()
  const cap = memoryCache.MAX_ENTRIES
  for (let i = 0; i < cap; i++) memoryCache.set(`k-${i}`, i, 60_000)
  await memoryCache.wrap('via-wrap', 60_000, async () => 'produced')
  assert.ok(memoryCache._store.size <= cap)
  assert.strictEqual(memoryCache.get('via-wrap'), 'produced')
})
