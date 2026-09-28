require('dotenv').config()
const { CLUBS, envFor, warnMissingEnv } = require('./clubs')

// One entry per club with PAYCHEX_COMPANY_<CLUB> set; others are left out
// (and logged at startup).
const PAYCHEX_LOCATIONS = CLUBS.map(c => ({
  companyId: envFor(c, 'PAYCHEX_COMPANY_'),
  name: c.name,
  slug: c.slug,
})).filter(loc => loc.companyId)
warnMissingEnv('Paychex companies', ['PAYCHEX_COMPANY_'])

function getPaychexBySlug(slug) {
  return PAYCHEX_LOCATIONS.find(l => l.slug === slug) || null
}

function getPaychexByLocationId(locationId, allLocations) {
  const loc = allLocations.find(l => l.id === locationId)
  if (!loc) return null
  return getPaychexBySlug(loc.name.toLowerCase())
}

module.exports = { PAYCHEX_LOCATIONS, getPaychexBySlug, getPaychexByLocationId }
