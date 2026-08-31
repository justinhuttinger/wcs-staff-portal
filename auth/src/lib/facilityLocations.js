// Which club/facility pairs are switched on.
//
// A row per pair, so "Salem has courts but no pool" is a fact in the database
// rather than something staff have to know. Read on every board request and on
// every staff page load, so it is cached -- but briefly, because switching a
// facility off should take effect while the person who did it is still looking
// at the screen.
//
// Missing row means ENABLED. The table is seeded full, so a missing row only
// happens for a club or facility added in code before anyone has configured it,
// and a new facility appearing switched on is a smaller surprise than one that
// silently renders nothing.
const cache = require('./../services/memoryCache')

const TTL_MS = 60 * 1000
const KEY = 'facility:locations'

async function loadMap() {
  return cache.wrap(KEY, TTL_MS, async () => {
    const { supabaseAdmin } = require('../services/supabase')
    const { data, error } = await supabaseAdmin
      .from('facility_locations')
      .select('club_number, facility, enabled')
    if (error) throw new Error(error.message)
    const map = {}
    for (const r of data || []) {
      map[`${r.club_number}:${r.facility}`] = r.enabled !== false
    }
    return map
  })
}

function invalidate() {
  cache.del(KEY)
}

// Pure, so the fallback rule is testable without a database.
function enabledIn(map, clubNumber, facility) {
  const v = (map || {})[`${clubNumber}:${facility}`]
  return v === undefined ? true : v
}

async function isEnabled(clubNumber, facility) {
  return enabledIn(await loadMap(), String(clubNumber), String(facility))
}

// The facilities a club has, in the order the allowlist declares them.
function facilitiesFor(map, clubNumber, facilities) {
  return (facilities || []).filter(f => enabledIn(map, String(clubNumber), f.slug))
}

module.exports = { loadMap, invalidate, isEnabled, enabledIn, facilitiesFor }
