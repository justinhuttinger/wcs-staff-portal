// The one list of WCS clubs, for everything in auth/.
//
// Source of truth: the public.clubs table, edited in Admin -> Clubs. index.js
// calls loadClubs() (config/loadClubs.js) BEFORE the app is required, which
// fills the arrays below in place. clubs.json (a copy of config/clubs.json) is
// only the fallback for when the database can't be read at boot, and the list
// tests and scripts run against.
//
// Existing modules (utils/locationSlug, lib/salespersonPerformance,
// config/ghlLocations, ...) build their exports from this list when they are
// first required, which is why the load has to happen first and why a club
// change restarts the service (see services/renderRestart.js).

const bundled = require('./clubs.json').clubs

// Every club, in house order (Salem first); several reports sort by it.
const ALL_CLUBS = []
// Clubs that are open and should appear in reports, pickers and syncs.
const CLUBS = []
const CLUB_BY_SLUG = {}
const CLUB_BY_NUMBER = {}
// Per-club secrets from public.club_secrets, keyed by club number. Kept off the
// club objects so nothing that serializes a club can leak them.
const SECRETS = new Map()
let source = 'bundled'

function clear(obj) { for (const k of Object.keys(obj)) delete obj[k] }

// Replace the list in place (same array/object identities, so anything already
// holding a reference sees the new list). clubs: registry-shaped objects.
function applyClubs(clubs, secrets = new Map(), from = 'bundled') {
  ALL_CLUBS.length = 0
  ALL_CLUBS.push(...clubs)
  CLUBS.length = 0
  CLUBS.push(...clubs.filter(c => c.active))
  clear(CLUB_BY_SLUG)
  clear(CLUB_BY_NUMBER)
  for (const c of CLUBS) {
    CLUB_BY_SLUG[c.slug] = c
    CLUB_BY_NUMBER[c.clubNumber] = c
  }
  SECRETS.clear()
  for (const [k, v] of secrets) SECRETS.set(k, v)
  source = from
}

applyClubs(bundled)

function clubSource() { return source }

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

// Per-club setting, e.g. envFor(club, 'GHL_API_KEY_'). A Render env var
// (GHL_API_KEY_SALEM) wins when set, so the existing clubs behave exactly as
// before; otherwise the value comes from the club's row / secrets, which is how
// a club added in the portal gets its credentials without an env var.
const FROM_DB = {
  GHL_LOCATION_: (c) => c.ghlLocationId,
  GHL_API_KEY_: (c) => SECRETS.get(c.clubNumber)?.ghlApiKey,
  PAYCHEX_COMPANY_: (c) => SECRETS.get(c.clubNumber)?.paychexCompanyId,
}
function envFor(club, prefix) {
  const env = process.env[`${prefix}${club.envKey}`]
  if (env) return env
  const fromDb = FROM_DB[prefix]
  return (fromDb && fromDb(club)) || undefined
}

// Warn (once per label) about clubs that a per-club credential list will skip.
// Before the registry these clubs vanished from syncs and reports silently.
const warned = new Set()
function warnMissingEnv(label, prefixes) {
  if (warned.has(label)) return
  warned.add(label)
  const missing = CLUBS.filter(c => prefixes.some(p => !envFor(c, p)))
  if (missing.length && process.env.NODE_ENV !== 'test') {
    const names = prefixes.map(p => `${p}<CLUB>`).join(' / ')
    console.warn(`[clubs] ${label}: skipping ${missing.map(c => c.name).join(', ')} (missing ${names} and no value in Admin -> Clubs)`)
  }
}

module.exports = {
  ALL_CLUBS,
  CLUBS,
  CLUB_BY_SLUG,
  CLUB_BY_NUMBER,
  applyClubs,
  clubSource,
  clubBySlug,
  clubByNumber,
  clubByName,
  envFor,
  warnMissingEnv,
}
