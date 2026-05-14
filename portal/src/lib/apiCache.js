// In-memory client-side cache for GET responses, keyed by canonical
// path+query string. Opt-in per endpoint via the TTL_BY_PATH map below —
// endpoints not listed are never cached, so `apiCache` has zero effect on
// writes or unknown endpoints.
//
// Stale-while-revalidate semantics live in `api.js`; this module only owns
// the storage + TTL bookkeeping.
//
// Cache lifetime: process memory only. Evicts on hard refresh / tab close /
// explicit logout. No localStorage hygiene to manage; no stale-after-restart
// surprises.

const store = new Map()

// TTL per endpoint, in milliseconds. Endpoints not in this map are NEVER
// cached — opt-in keeps writes safe by default.
const TTL_BY_PATH = {
  // /tickets/status is already server-cached for 1h with a background
  // refresh, so a short client cache just elides the round-trip cost.
  '/tickets/status':                                        5 * 60_000,

  // Reports — broad TTLs that match how often the underlying data changes.
  '/reports/club-health':                                       60_000,
  '/reports/checkins':                                     2 * 60_000,
  '/reports/revenue':                                           60_000,
  '/reports/membership':                                        60_000,
  '/reports/cancels':                                           60_000,
  '/reports/pt-roster':                                    2 * 60_000,
  '/reports/payroll':                                      5 * 60_000,
  '/reports/pt-sessions':                                  2 * 60_000,
  '/reports/pt-new-clients':                               5 * 60_000,
  '/reports/pt-health':                                    5 * 60_000,
  '/reports/deactivated-pt':                               5 * 60_000,
  '/reports/session-frequency':                            5 * 60_000,

  // Filter-option lookups change rarely; long TTL is fine.
  '/reports/website-submissions/filter-options':           5 * 60_000,
}

// Return the TTL for a request path, or 0 if the endpoint isn't cacheable.
// Compares the request's path portion (everything before `?`) against the
// configured keys, longest-prefix-wins so `/reports/website-submissions/filter-options`
// beats `/reports/website-submissions` if both ever coexist.
function ttlForPath(pathOnly) {
  let best = 0
  let bestLen = -1
  for (const key of Object.keys(TTL_BY_PATH)) {
    if (pathOnly === key || pathOnly.startsWith(key + '?') || pathOnly.startsWith(key + '/')) {
      if (key.length > bestLen) {
        bestLen = key.length
        best = TTL_BY_PATH[key]
      }
    }
  }
  return best
}

// Build a stable cache key from a request path + query string. We split on
// '?' and sort the query params so `?b=2&a=1` and `?a=1&b=2` collide as
// expected.
export function keyFor(path) {
  const [pathOnly, query] = path.split('?')
  if (!query) return pathOnly
  const parts = query.split('&').filter(Boolean).sort()
  return pathOnly + '?' + parts.join('&')
}

export function isCacheable(path) {
  const pathOnly = path.split('?')[0]
  return ttlForPath(pathOnly) > 0
}

// Returns { value, fresh } if an entry exists, otherwise null. `fresh`
// indicates whether the entry is within its TTL — callers use this for
// stale-while-revalidate.
export function get(path) {
  const key = keyFor(path)
  const entry = store.get(key)
  if (!entry) return null
  const fresh = Date.now() < entry.expiresAt
  return { value: entry.value, fresh }
}

export function set(path, value) {
  const pathOnly = path.split('?')[0]
  const ttl = ttlForPath(pathOnly)
  if (ttl <= 0) return // unconfigured endpoint, never cache
  const key = keyFor(path)
  store.set(key, { value, expiresAt: Date.now() + ttl })
}

// Invalidate every cache entry whose key starts with the given path prefix.
// Use after writes so the next read goes to the network.
export function invalidate(prefix) {
  const norm = prefix.split('?')[0]
  for (const key of store.keys()) {
    if (key === norm || key.startsWith(norm + '?') || key.startsWith(norm + '/')) {
      store.delete(key)
    }
  }
}

// Drop everything. Called on logout so the next user doesn't see anything
// the previous one fetched.
export function clear() {
  store.clear()
}

// Dev helper: count of entries currently held.
export function size() {
  return store.size
}
