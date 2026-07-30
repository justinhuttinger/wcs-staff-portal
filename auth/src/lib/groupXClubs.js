// The seven WCS clubs. Mirrors CLUB_NUMBERS in portal/src/components/admin/
// PtSchedulerView.jsx. This is an allowlist, not a convenience map: the public
// board is unauthenticated, so an unrecognized slug must 404 rather than let a
// caller proxy an arbitrary club number through our ABC credentials.
const CLUBS = [
  { slug: 'salem', name: 'Salem', clubNumber: '30935' },
  { slug: 'keizer', name: 'Keizer', clubNumber: '31599' },
  { slug: 'eugene', name: 'Eugene', clubNumber: '7655' },
  { slug: 'springfield', name: 'Springfield', clubNumber: '31598' },
  { slug: 'clackamas', name: 'Clackamas', clubNumber: '31600' },
  { slug: 'milwaukie', name: 'Milwaukie', clubNumber: '31601' },
  { slug: 'medford', name: 'Medford', clubNumber: '32073' },
]

function clubBySlug(slug) {
  if (!slug) return null
  const s = String(slug).toLowerCase()
  return CLUBS.find(c => c.slug === s) || null
}

function isKnownClubNumber(n) {
  return CLUBS.some(c => c.clubNumber === String(n))
}

module.exports = { CLUBS, clubBySlug, isKnownClubNumber }
