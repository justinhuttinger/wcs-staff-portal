// Tiny in-memory TTL cache. Per-instance, evicted on restart — fine for a
// single-instance Render Web Service. Use this only for read-heavy responses
// where a few minutes of staleness is acceptable.
//
// Render constraint: this is in-memory and per-instance. If the auth API ever
// scales to >1 instance, every entry needs to move to Redis (or similar) or
// each instance will warm its own cache independently and users will see
// inconsistent freshness.

const store = new Map() // key -> { value, freshUntil, expiresAt }
const inflight = new Map() // key -> Promise (singleflight for cold miss + bg refresh)

// Lightweight counters for ops visibility. Reset on process restart.
const stats = {
  freshHits: 0,
  staleServes: 0,
  misses: 0,
  bgRefreshes: 0,
  bgRefreshErrors: 0,
  singleflightDedupes: 0,
}

function getStats() {
  return { ...stats, size: store.size, inflight: inflight.size }
}

function resetStats() {
  for (const k of Object.keys(stats)) stats[k] = 0
}

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
  const now = Date.now()
  store.set(key, { value, freshUntil: now + ttlMs, expiresAt: now + ttlMs })
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

// Stale-while-revalidate read-through.
//
//   freshMs  → how long the entry is considered fresh (no refresh on read)
//   staleMs  → additional window after freshMs in which we serve the cached
//              value AND trigger a background refresh. After freshMs+staleMs
//              the entry is gone and the next read becomes a cold miss.
//
// Singleflight: while a producer is in flight for a given key, concurrent
// callers either (a) await the same promise if there's no usable cached entry,
// or (b) return the cached value immediately if one exists (stale-serve path).
//
// Background refresh failures are caught and logged — they do NOT crash the
// caller and do NOT poison the cache; the previously-cached value continues
// to be served until the entry expires.
async function wrapSWR(key, freshMs, staleMs, producer) {
  const now = Date.now()
  const hit = store.get(key)

  if (hit && now < hit.expiresAt) {
    if (now < hit.freshUntil) {
      stats.freshHits++
      return hit.value
    }
    // Stale window: serve cached, kick off bg refresh (singleflight per key).
    stats.staleServes++
    if (!inflight.has(key)) {
      const p = (async () => {
        try {
          const value = await producer()
          const t = Date.now()
          store.set(key, { value, freshUntil: t + freshMs, expiresAt: t + freshMs + staleMs })
          stats.bgRefreshes++
        } catch (err) {
          stats.bgRefreshErrors++
          console.warn(`[memoryCache] background refresh failed for ${key}:`, err.message || err)
        } finally {
          inflight.delete(key)
        }
      })()
      inflight.set(key, p)
    }
    return hit.value
  }

  // Cold miss (no entry, or fully expired). Singleflight the producer so
  // concurrent callers share one upstream call.
  if (inflight.has(key)) {
    stats.singleflightDedupes++
    return inflight.get(key)
  }

  stats.misses++
  const p = (async () => {
    try {
      const value = await producer()
      const t = Date.now()
      store.set(key, { value, freshUntil: t + freshMs, expiresAt: t + freshMs + staleMs })
      return value
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

module.exports = { get, set, del, wrap, wrapSWR, getStats, resetStats }
