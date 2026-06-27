// Lowercased WCS location name -> ABC club number. The locations table does not
// carry the club number, so this is the canonical mapping for ABC-scoped queries
// (e.g. abc_employees). Mirrors ghl-sync/src/config/locations.js.
const NAME_TO_CLUB = {
  salem: '30935',
  keizer: '31599',
  eugene: '7655',
  springfield: '31598',
  clackamas: '31600',
  milwaukie: '31601',
  medford: '32073',
}

function clubNumberForLocationName(name) {
  if (!name) return null
  return NAME_TO_CLUB[name.trim().toLowerCase()] || null
}

module.exports = { clubNumberForLocationName, NAME_TO_CLUB }
