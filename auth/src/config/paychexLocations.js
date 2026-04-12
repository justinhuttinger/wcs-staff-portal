require('dotenv').config()

const PAYCHEX_LOCATIONS = [
  { companyId: process.env.PAYCHEX_COMPANY_SALEM,       name: 'Salem',       slug: 'salem' },
  { companyId: process.env.PAYCHEX_COMPANY_KEIZER,      name: 'Keizer',      slug: 'keizer' },
  { companyId: process.env.PAYCHEX_COMPANY_EUGENE,      name: 'Eugene',      slug: 'eugene' },
  { companyId: process.env.PAYCHEX_COMPANY_SPRINGFIELD, name: 'Springfield', slug: 'springfield' },
  { companyId: process.env.PAYCHEX_COMPANY_CLACKAMAS,   name: 'Clackamas',   slug: 'clackamas' },
  { companyId: process.env.PAYCHEX_COMPANY_MILWAUKIE,   name: 'Milwaukie',   slug: 'milwaukie' },
  { companyId: process.env.PAYCHEX_COMPANY_MEDFORD,     name: 'Medford',     slug: 'medford' },
].filter(loc => loc.companyId)

function getPaychexBySlug(slug) {
  return PAYCHEX_LOCATIONS.find(l => l.slug === slug) || null
}

function getPaychexByLocationId(locationId, allLocations) {
  const loc = allLocations.find(l => l.id === locationId)
  if (!loc) return null
  return getPaychexBySlug(loc.name.toLowerCase())
}

module.exports = { PAYCHEX_LOCATIONS, getPaychexBySlug, getPaychexByLocationId }
