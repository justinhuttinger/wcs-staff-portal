require('dotenv').config()

const LOCATIONS = [
  { id: process.env.GHL_LOCATION_SALEM,       apiKey: process.env.GHL_API_KEY_SALEM,       name: 'Salem',       slug: 'salem',       clubCode: '30935' },
  { id: process.env.GHL_LOCATION_KEIZER,      apiKey: process.env.GHL_API_KEY_KEIZER,      name: 'Keizer',      slug: 'keizer',      clubCode: '31599' },
  { id: process.env.GHL_LOCATION_EUGENE,      apiKey: process.env.GHL_API_KEY_EUGENE,      name: 'Eugene',      slug: 'eugene',      clubCode: '7655'  },
  { id: process.env.GHL_LOCATION_SPRINGFIELD, apiKey: process.env.GHL_API_KEY_SPRINGFIELD, name: 'Springfield', slug: 'springfield', clubCode: '31598' },
  { id: process.env.GHL_LOCATION_CLACKAMAS,   apiKey: process.env.GHL_API_KEY_CLACKAMAS,   name: 'Clackamas',   slug: 'clackamas',   clubCode: '31600' },
  { id: process.env.GHL_LOCATION_MILWAUKIE,   apiKey: process.env.GHL_API_KEY_MILWAUKIE,   name: 'Milwaukie',   slug: 'milwaukie',   clubCode: '31601' },
  { id: process.env.GHL_LOCATION_MEDFORD,     apiKey: process.env.GHL_API_KEY_MEDFORD,     name: 'Medford',     slug: 'medford',     clubCode: '32073' },
].filter(loc => loc.id && loc.apiKey)

function getLocationBySlug(slug) {
  return LOCATIONS.find(l => l.slug === slug) || null
}

function getLocationByClubCode(clubCode) {
  const norm = String(clubCode || '').trim()
  if (!norm) return null
  return LOCATIONS.find(l => l.clubCode === norm) || null
}

function getLocationById(locationId) {
  const norm = String(locationId || '').trim()
  if (!norm) return null
  return LOCATIONS.find(l => l.id === norm) || null
}

module.exports = { LOCATIONS, getLocationBySlug, getLocationByClubCode, getLocationById }
