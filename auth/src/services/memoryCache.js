// Tiny in-memory TTL cache. Per-instance, evicted on restart — fine for a
// single-instance Render Web Service. Use this only for read-heavy responses
// where a few minutes of staleness is acceptable.

const store = new Map() // key -> { value, expiresAt }

function get(key) {
  const hit = store.get(key)
  if (!hit) return undefined
  if (Date.now() >= hit.expiresAt) {
    store.delete(key)
    return undefined
  }
  return hit.value
}

function set(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

function del(key) {
  store.delete(key)
}

// Cached read-through: if the key is fresh, return it; otherwise call producer().
async function wrap(key, ttlMs, producer) {
  const cached = get(key)
  if (cached !== undefined) return cached
  const value = await producer()
  set(key, value, ttlMs)
  return value
}

module.exports = { get, set, del, wrap }
