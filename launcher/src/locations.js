// The WCS locations and their per-club ABC Financial workstation URLs, from
// clubs.json (a copy of config/clubs.json at the repo root; edit that file and
// run `node scripts/sync-clubs.js`). Used by the in-app location picker at
// first launch. The Windows NSIS installer (installer.nsh) keeps its own copy
// of the names and URLs because it has to write config.json before the
// launcher first runs — keep it in sync when adding or changing a location.

const CLUBS = require('./clubs.json').clubs.filter(c => c.active)

const LOCATIONS = CLUBS.map(c => ({ name: c.name, abc_url: c.abcUrl }))

// Club name -> ABC club number, longest numbers first so a short number
// ('7655', Eugene) never matches as the prefix of a longer agreement number
// ahead of the club it belongs to. Handed to the sandboxed abc-scraper preload.
const CLUB_NUMBERS = Object.fromEntries(
  [...CLUBS]
    .sort((a, b) => b.clubNumber.length - a.clubNumber.length)
    .map(c => [c.name, c.clubNumber]),
)

function getAbcUrlFor(locationName) {
  const match = LOCATIONS.find(l => l.name.toLowerCase() === String(locationName || '').toLowerCase())
  return match ? match.abc_url : ''
}

module.exports = { LOCATIONS, CLUB_NUMBERS, getAbcUrlFor }
