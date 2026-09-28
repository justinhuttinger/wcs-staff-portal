// The one list of WCS clubs, for everything in auth/.
//
// The data lives in clubs.json, a copy of config/clubs.json at the repo root.
// To add or change a club, edit the root file and run
// `node scripts/sync-clubs.js`; never edit the copy here by hand.
//
// Existing modules (utils/locationSlug, lib/salespersonPerformance,
// config/ghlLocations, ...) keep their exports and build them from this list,
// so callers did not change when the list moved here.

const { clubs: ALL_CLUBS } = require('./clubs.json')

// Clubs that are open and should appear in reports, pickers and syncs.
// Order is the house order (Salem first, Medford last); several reports sort by it.
const CLUBS = ALL_CLUBS.filter(c => c.active)

const CLUB_BY_SLUG = Object.fromEntries(CLUBS.map(c => [c.slug, c]))
const CLUB_BY_NUMBER = Object.fromEntries(CLUBS.map(c => [c.clubNumber, c]))

function clubBySlug(slug) {
  if (!slug) return null
  return CLUB_BY_SLUG[String(slug).trim().toLowerCase()] || null
}

// Tolerates the zero-padded form ('07655') that some ABC tables store.
function clubByNumber(n) {
  const raw = String(n ?? '').trim()
  return CLUB_BY_NUMBER[raw] || CLUB_BY_NUMBER[raw.replace(/^0+/, '')] || null
}

function clubByName(name) {
  if (!name) return null
  const n = String(name).trim().toLowerCase()
  return CLUBS.find(c => c.name.toLowerCase() === n) || null
}

// Per-club env var value, e.g. envFor(club, 'GHL_API_KEY_') -> process.env.GHL_API_KEY_SALEM
function envFor(club, prefix) {
  return process.env[`${prefix}${club.envKey}`]
}

// Warn (once per prefix) about clubs that a per-club env var list will skip.
// Before the registry these clubs vanished from syncs and reports silently.
const warned = new Set()
function warnMissingEnv(label, prefixes) {
  if (warned.has(label)) return
  warned.add(label)
  const missing = CLUBS.filter(c => prefixes.some(p => !envFor(c, p)))
  if (missing.length && process.env.NODE_ENV !== 'test') {
    const names = prefixes.map(p => `${p}<CLUB>`).join(' / ')
    console.warn(`[clubs] ${label}: skipping ${missing.map(c => c.name).join(', ')} (missing ${names})`)
  }
}

module.exports = {
  ALL_CLUBS,
  CLUBS,
  CLUB_BY_SLUG,
  CLUB_BY_NUMBER,
  clubBySlug,
  clubByNumber,
  clubByName,
  envFor,
  warnMissingEnv,
}
