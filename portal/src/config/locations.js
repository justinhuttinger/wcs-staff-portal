// Single source of truth for gym locations in the portal.
// Used across ToolGrid, Leaderboard, Reports, Communication Notes, etc.
//
// The live list comes from the auth API (GET /public/clubs, i.e. the
// public.clubs table edited in Admin -> Clubs). Every entry point awaits
// loadClubs() BEFORE importing the app, because many components build their
// club lists when first imported. Until then (and whenever the API is
// unreachable) the list is the last one this browser saw, or the bundled
// clubs.json.
import registry from './clubs.json' with { type: 'json' }

// Active clubs as { slug, name, clubNumber, timezone, active, tradingName?, ... },
// in house order (Salem first).
export const CLUBS = []
export const LOCATION_NAMES = []
// With "All" prefix (for filter pills that include an All option)
export const LOCATIONS_WITH_ALL = []
// Slug-label pairs (for report selectors)
export const LOCATION_OPTIONS = []
// ABC club number -> club name (NPS, Save offers, Day One programs, ...)
export const CLUB_NAME_BY_NUMBER = {}
// Lowercased club name -> the club's photo. A club without a photo is simply
// absent, so callers fall back to their default background.
export const LOCATION_BACKGROUNDS = {}

function clear(obj) { for (const k of Object.keys(obj)) delete obj[k] }

// Fill every export in place (same identities, so importers see the new list).
export function applyClubs(clubs) {
  const active = clubs.filter(c => c.active !== false)
  CLUBS.length = 0
  CLUBS.push(...active)
  LOCATION_NAMES.length = 0
  LOCATION_NAMES.push(...active.map(c => c.name))
  LOCATIONS_WITH_ALL.length = 0
  LOCATIONS_WITH_ALL.push('All', ...LOCATION_NAMES)
  LOCATION_OPTIONS.length = 0
  LOCATION_OPTIONS.push({ slug: 'all', label: 'All Locations' }, ...active.map(c => ({ slug: c.slug, label: c.name })))
  clear(CLUB_NAME_BY_NUMBER)
  for (const c of active) CLUB_NAME_BY_NUMBER[c.clubNumber] = c.name
  clear(LOCATION_BACKGROUNDS)
  for (const c of active) if (c.background) LOCATION_BACKGROUNDS[c.name.toLowerCase()] = c.background
}

applyClubs(registry.clubs)

const CACHE_KEY = 'wcs_clubs_v1'
const FETCH_TIMEOUT_MS = 3000

function validList(list) {
  return Array.isArray(list) && list.length > 0 &&
    list.every(c => c && typeof c.slug === 'string' && typeof c.name === 'string' && typeof c.clubNumber === 'string')
}

function readCache() {
  try {
    const list = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return validList(list) ? list : null
  } catch { return null }
}

async function fetchClubs() {
  const base = (import.meta.env && import.meta.env.VITE_API_URL) || 'http://localhost:3001'
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(base + '/public/clubs', { signal: ctl.signal })
    if (!r.ok) return null
    const body = await r.json()
    return validList(body && body.clubs) ? body.clubs : null
  } catch { return null } finally { clearTimeout(timer) }
}

function saveCache(list) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)) } catch { /* private mode */ }
}

// Called once by each entry point before the app is imported. With a cached
// list it resolves immediately and refreshes the cache in the background (a new
// club shows on the next load); with no cache it waits for the API, up to 3s.
export async function loadClubs() {
  const cached = readCache()
  if (cached) {
    applyClubs(cached)
    fetchClubs().then(list => { if (list) saveCache(list) })
    return
  }
  const list = await fetchClubs()
  if (list) {
    applyClubs(list)
    saveCache(list)
  }
}
