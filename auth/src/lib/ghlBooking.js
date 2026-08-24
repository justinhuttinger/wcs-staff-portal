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

// ---------------------------------------------------------------------------
// Day One roster
//
// Who may run a Day One is the Day One calendar's round-robin membership - the
// people GHL can actually assign - so both the booking widget and the program
// intake site read it from there rather than keeping a list of names in sync
// by hand.
//
// teamMembers is NOT stable: adding a trainer to the calendar in GHL changes
// it, and a long hold meant staff added someone and then could not find them
// with no way to tell whether they had done it wrong. Five minutes absorbs a
// session's worth of requests, and clearRosterCache() makes the wait optional.
// ---------------------------------------------------------------------------

const ROSTER_TTL = 5 * 60 * 1000
const CALENDAR_NAME = 'day one'

const calendarCache = {}  // slug -> { promise, at }
const userCache = {}      // slug -> { promise, at }

function clearRosterCache(slug) {
  delete calendarCache[slug]
  delete userCache[slug]
}

function getDayOneCalendar(loc) {
  return cached(calendarCache, loc.slug, ROSTER_TTL, async () => {
    const list = await ghlFetch('/calendars/', loc.apiKey, {
      params: { locationId: loc.id }, version: CAL_VERSION,
    })
    const match = (list.calendars || []).find(
      c => (c.name || '').trim().toLowerCase() === CALENDAR_NAME)
    if (!match) throw new Error(`No "Day One" calendar found for ${loc.name}`)
    // The list payload omits teamMembers on some calendars; the detail call is
    // authoritative for the round-robin roster and slot duration.
    const detail = await ghlFetch(`/calendars/${match.id}`, loc.apiKey, { version: CAL_VERSION })
    return detail.calendar || detail || match
  })
}

function getUsersById(loc) {
  return cached(userCache, loc.slug, ROSTER_TTL, async () => {
    const data = await ghlFetch('/users/', loc.apiKey, { params: { locationId: loc.id } })
    const byId = {}
    for (const u of (data.users || [])) {
      byId[u.id] = {
        id: u.id,
        name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' '),
        email: (u.email || '').toLowerCase(),
      }
    }
    return byId
  })
}

// Resolve the calendar's members to real names. A member with no matching user
// is dropped rather than shown as a blank row.
function toRoster(calendar, usersById) {
  const members = Array.isArray(calendar.teamMembers) ? calendar.teamMembers : []
  return members
    .map(m => {
      const userId = typeof m === 'string' ? m : (m.userId || m.id)
      const user = usersById[userId]
      if (!user) return null
      return { userId, name: user.name, email: user.email, priority: m.priority ?? null }
    })
    .filter(Boolean)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name))
}

async function trainerRoster(loc) {
  const [calendar, usersById] = await Promise.all([getDayOneCalendar(loc), getUsersById(loc)])
  return toRoster(calendar, usersById)
}

module.exports = {
  CAL_VERSION, cached, bookableDays, mapLimit, slotsFor, slotsByDate, clearSlotsCache,
  ROSTER_TTL, CALENDAR_NAME, clearRosterCache,
  getDayOneCalendar, getUsersById, toRoster, trainerRoster,
}
