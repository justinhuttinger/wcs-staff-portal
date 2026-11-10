// Which features each club has: courts, a pool, Group X.
//
// A row per club/feature pair, so "Salem has courts but no pool" is a fact in
// the database rather than something staff have to know. Read on every board
// request and every staff page load, so it is cached -- but briefly, because
// switching a feature off should take effect while the person who did it is
// still looking at the screen.
//
// Missing row means ENABLED. The table is seeded full, so a missing row only
// happens for a club or feature added in code before anyone has configured it,
// and a new feature appearing switched on is a smaller surprise than one that
// silently renders nothing.
const cache = require('./../services/memoryCache')

const TTL_MS = 60 * 1000
const KEY = 'club:features'

async function loadMap() {
  return cache.wrap(KEY, TTL_MS, async () => {
    const { supabaseAdmin } = require('../services/supabase')
    const { data, error } = await supabaseAdmin
      .from('club_features')
      .select('club_number, feature, enabled')
    if (error) throw new Error(error.message)
    const map = {}
    for (const r of data || []) {
      map[`${r.club_number}:${r.feature}`] = r.enabled !== false
    }
    return map
  })
}

function invalidate() {
  cache.del(KEY)
}

// Every feature key that can be toggled. Facilities come from the allowlist;
// groupx is the one that is not a facility.
const GROUP_X = 'groupx'
// Split one club's Group X board into its Group X and Ultimate areas (see
// lib/groupXAreas.js). Unlike everything else here this is an opt-in for one
// club's way of running classes, not a fact every club has, so a missing row
// means OFF.
const GROUP_X_AREAS = 'groupx_areas'
const DEFAULT_OFF = new Set([GROUP_X_AREAS])

// Pure, so the fallback rule is testable without a database.
function enabledIn(map, clubNumber, feature) {
  const v = (map || {})[`${clubNumber}:${feature}`]
  return v === undefined ? !DEFAULT_OFF.has(String(feature)) : v
}

async function isEnabled(clubNumber, feature) {
  return enabledIn(await loadMap(), String(clubNumber), String(feature))
}

// The facilities a club has, in the order the allowlist declares them.
function facilitiesFor(map, clubNumber, facilities) {
  return (facilities || []).filter(f => enabledIn(map, String(clubNumber), f.slug))
}

// The clubs that have a given feature, in CLUBS order. Used to narrow a club
// list that has already been narrowed to the caller's own clubs.
function clubsWith(map, clubs, feature) {
  return (clubs || []).filter(c => enabledIn(map, String(c.clubNumber), feature))
}

module.exports = { loadMap, invalidate, isEnabled, enabledIn, facilitiesFor, clubsWith, GROUP_X, GROUP_X_AREAS }
