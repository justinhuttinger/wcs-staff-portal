// Pieces shared by every GHL-backed booking page.
//
// Extracted when the second booking type arrived (Meet with Justin). Nothing in
// here knows about Day One or any particular calendar — booking-type specifics
// stay in the route that owns them.
const { ghlFetch } = require('../services/ghlClient')

const CAL_VERSION = '2021-04-15'

// Caches the in-flight PROMISE, not the resolved value, which makes it
// single-flight: a page load asks for the calendar, the roster and the fields
// concurrently, and some of those need the calendar too. Caching values alone
// let all of them race past an empty cache and refetch the same thing.
function cached(store, key, ttl, produce) {
  const hit = store[key]
  if (hit && (Date.now() - hit.at) < ttl) return hit.promise
  // A rejection must not be cached, or one blip poisons the entry for the TTL.
  const promise = produce().catch(err => { delete store[key]; throw err })
  store[key] = { promise, at: Date.now() }
  return promise
}

// How far ahead a calendar will actually accept a booking, in days. free-slots
// simply stops returning slots past this, so asking wider is wasted latency.
// Calendars with no cap set fall back to a month.
function bookableDays(calendar) {
  const n = Number(calendar.allowBookingFor)
  if (!Number.isFinite(n) || n <= 0) return 31
  const unit = String(calendar.allowBookingForUnit || 'days').toLowerCase()
  if (unit.startsWith('hour')) return Math.max(1, Math.ceil(n / 24))
  if (unit.startsWith('week')) return n * 7
  if (unit.startsWith('month')) return n * 31
  return n
}

// Run async work with a concurrency ceiling. GHL rate limits per location and
// ghlClient backs off a full 5s on a 429, so a burst is far more expensive than
// a queue: two at a time is dramatically faster than six at once.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

// free-slots responses, cached briefly. Availability moves slowly relative to
// someone switching between options or nudging the timezone, and each of those
// was otherwise a fresh round trip.
const SLOTS_TTL = 45 * 1000
const slotsCache = {}

function slotsFor(loc, calendar, params) {
  // Bucket the window so millisecond-different startDates still share an entry.
  const key = [
    loc.slug || loc.id, calendar.id, params.userId || 'any', params.timezone,
    Math.floor(params.startDate / 60000), Math.floor(params.endDate / 60000),
  ].join('|')
  return cached(slotsCache, key, SLOTS_TTL, () =>
    ghlFetch(`/calendars/${calendar.id}/free-slots`, loc.apiKey, {
      params, version: CAL_VERSION,
    }))
}

// free-slots comes back keyed by date with a stray traceId at the top level.
// Returns { 'YYYY-MM-DD': [iso, …] } with empty days dropped.
function slotsByDate(data) {
  const byDate = {}
  for (const [key, val] of Object.entries(data || {})) {
    if (key === 'traceId' || !val || !Array.isArray(val.slots)) continue
    if (val.slots.length) byDate[key] = val.slots
  }
  return byDate
}

function clearSlotsCache(prefix) {
  for (const key of Object.keys(slotsCache)) {
    if (!prefix || key.startsWith(prefix + '|')) delete slotsCache[key]
  }
}

module.exports = {
  CAL_VERSION, cached, bookableDays, mapLimit, slotsFor, slotsByDate, clearSlotsCache,
}
