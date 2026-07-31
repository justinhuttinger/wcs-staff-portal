// Deciding what to seed. Pure, so the interesting judgements are testable
// without touching ABC.

// ABC only accepts bookings 14 days out, so there is no point looking further.
const SEED_WINDOW_DAYS = 14

// Picks how many accounts to enrol, inclusive of both ends. `rand` is injected
// so tests are deterministic.
function pickCount(min, max, rand) {
  const lo = Math.max(0, Math.floor(min))
  const hi = Math.max(lo, Math.floor(max))
  const r = typeof rand === 'function' ? rand() : Math.random()
  return lo + Math.floor(r * (hi - lo + 1))
}

// Rotates which accounts get used rather than always taking the first N.
// Always seeing the same three names in every class is exactly the tell we are
// trying not to leave, and it also spreads the load across accounts.
function pickAccounts(accounts, count, offset) {
  const pool = (accounts || []).filter(a => a && a.active !== false && a.member_id)
  if (pool.length === 0 || count <= 0) return []
  const n = Math.min(count, pool.length)
  const start = Math.abs(Math.floor(offset || 0)) % pool.length
  const out = []
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length])
  return out
}

// A stable per-class offset, so re-running the job picks the same accounts for
// the same class instead of piling different ones in on every pass.
function offsetForEvent(eventId) {
  const s = String(eventId || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// Which classes to seed.
//
// Only classes that currently have NOBODY booked. Once a real member books, the
// class no longer looks abandoned and there is nothing to fix — and we must not
// stack house accounts on top of real ones.
function selectClassesToSeed(classes, opts) {
  const o = opts || {}
  const nowIso = o.nowIso || new Date().toISOString()
  const horizon = o.horizonIso

  return (classes || []).filter(c => {
    if (!c || !c.event_id) return false
    if ((c.member_count || 0) > 0) return false
    // An unassigned placeholder slot is not a real class.
    if (c.unbooked === true) return false
    const status = String(c.status || '').toLowerCase()
    if (status.includes('cancel')) return false
    // Future only. Seeding a class that has already happened fixes nothing.
    if (!c.event_timestamp || c.event_timestamp <= nowIso) return false
    if (horizon && c.event_timestamp > horizon) return false
    return true
  })
}

module.exports = {
  SEED_WINDOW_DAYS, pickCount, pickAccounts, offsetForEvent, selectClassesToSeed,
}
