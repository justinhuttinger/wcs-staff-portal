// Facilities that have their own public schedule board.
//
// An allowlist, not a free-text field: the public board is unauthenticated, so
// an unknown facility must 404 rather than run a query built from user input.
// Adding a third facility is a line here plus a board link.
const FACILITIES = [
  { slug: 'courts', label: 'Courts', title: 'Court Schedule' },
  { slug: 'pool', label: 'Pool', title: 'Pool Schedule' },
]

function facilityBySlug(slug) {
  if (!slug) return null
  const s = String(slug).toLowerCase()
  return FACILITIES.find(f => f.slug === s) || null
}

function isKnownFacility(slug) {
  return !!facilityBySlug(slug)
}

module.exports = { FACILITIES, facilityBySlug, isKnownFacility }
