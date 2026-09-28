// The WCS clubs, from config/clubs. This is an allowlist, not a convenience
// map: the public board is unauthenticated, so an unrecognized slug must 404
// rather than let a caller proxy an arbitrary club number through our ABC
// credentials.
const { CLUBS: REGISTRY } = require('../config/clubs')

const CLUBS = REGISTRY.map(c => ({ slug: c.slug, name: c.name, clubNumber: c.clubNumber }))

function clubBySlug(slug) {
  if (!slug) return null
  const s = String(slug).toLowerCase()
  return CLUBS.find(c => c.slug === s) || null
}

function isKnownClubNumber(n) {
  return CLUBS.some(c => c.clubNumber === String(n))
}

module.exports = { CLUBS, clubBySlug, isKnownClubNumber }
