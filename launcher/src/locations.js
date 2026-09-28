// The WCS locations and their per-club ABC Financial workstation URLs.
//
// The live list comes from the auth API (GET /public/clubs, i.e. the clubs
// edited in the portal's Admin -> Clubs). refreshClubs() runs once at startup,
// before the location picker; it caches the list in the data dir so a PC that
// starts offline still has the last list it saw. Before that (or with no
// network and no cache) the list is the bundled clubs.json.
//
// LOCATIONS and CLUB_NUMBERS are filled in place, so the IPC handlers that
// hand them out always see the current list.

const fs = require('fs')
const path = require('path')

const bundled = require('./clubs.json').clubs

const LOCATIONS = []
const CLUB_NUMBERS = {}

function applyClubs(clubs) {
  const active = clubs.filter(c => c.active !== false)
  LOCATIONS.length = 0
  LOCATIONS.push(...active.map(c => ({ name: c.name, abc_url: c.abcUrl || '' })))
  for (const k of Object.keys(CLUB_NUMBERS)) delete CLUB_NUMBERS[k]
  // Longest numbers first so a short number ('7655', Eugene) never matches as
  // the prefix of a longer agreement number ahead of the club it belongs to.
  // Handed to the sandboxed abc-scraper preload.
  for (const c of [...active].sort((a, b) => b.clubNumber.length - a.clubNumber.length)) {
    CLUB_NUMBERS[c.name] = c.clubNumber
  }
}

applyClubs(bundled)

function validList(list) {
  return Array.isArray(list) && list.length > 0 &&
    list.every(c => c && typeof c.name === 'string' && typeof c.clubNumber === 'string')
}

function cacheFile() {
  return process.env.WCS_CLUBS_CACHE || path.join(require('./paths').dataDir(), 'clubs-cache.json')
}

function readCache() {
  try {
    const list = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
    return validList(list) ? list : null
  } catch { return null }
}

function writeCache(list) {
  try {
    require('./paths').ensureDir(path.dirname(cacheFile()))
    fs.writeFileSync(cacheFile(), JSON.stringify(list))
  } catch {}
}

// Never throws. Returns where the list came from: 'api' | 'cache' | 'bundled'.
async function refreshClubs({ apiUrl, fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  const base = apiUrl || require('./config').API_URL
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await fetchImpl(base + '/public/clubs', { signal: ctl.signal })
      if (r.ok) {
        const body = await r.json()
        if (validList(body && body.clubs)) {
          applyClubs(body.clubs)
          writeCache(body.clubs)
          return 'api'
        }
      }
    } finally { clearTimeout(timer) }
  } catch {}
  const cached = readCache()
  if (cached) { applyClubs(cached); return 'cache' }
  return 'bundled'
}

// Startup: use the cached list right away and refresh it in the background, so
// a launch never waits on the network; only a PC with no cache yet (first
// launch, when the location picker needs the list) waits for the API.
async function loadClubsAtStartup(opts) {
  const cached = readCache()
  if (cached) {
    applyClubs(cached)
    refreshClubs(opts).then(src => log(`[clubs] refreshed from ${src}`))
    return 'cache'
  }
  const src = await refreshClubs(opts)
  log(`[clubs] loaded from ${src}`)
  return src
}

function log(msg) {
  try { require('./paths').appendLog(msg) } catch { console.log(msg) }
}

function getAbcUrlFor(locationName) {
  const match = LOCATIONS.find(l => l.name.toLowerCase() === String(locationName || '').toLowerCase())
  return match ? match.abc_url : ''
}

module.exports = { LOCATIONS, CLUB_NUMBERS, applyClubs, refreshClubs, loadClubsAtStartup, getAbcUrlFor }
