require('dotenv').config()
const { CLUBS, envFor, warnMissingEnv } = require('./clubs')

// One entry per club with GHL_LOCATION_<CLUB> and GHL_API_KEY_<CLUB> set.
// A club missing either is left out (and logged at startup).
const LOCATIONS = CLUBS.map(c => ({
  id: envFor(c, 'GHL_LOCATION_'),
  apiKey: envFor(c, 'GHL_API_KEY_'),
  name: c.name,
  slug: c.slug,
  clubCode: c.clubNumber,
})).filter(loc => loc.id && loc.apiKey)
warnMissingEnv('GHL locations', ['GHL_LOCATION_', 'GHL_API_KEY_'])

// WCS University sub-account (not one of the 7 clubs). Its own location-level
// private-integration token carries contacts.write + users.write so the portal
// can enroll trainees and seed their practice contacts. Separate from LOCATIONS
// so it never shows up as a club in reports/pickers.
const UNIVERSITY = (process.env.GHL_UNIVERSITY_LOCATION_ID && process.env.GHL_UNIVERSITY_API_KEY)
  ? {
      id: process.env.GHL_UNIVERSITY_LOCATION_ID,
      apiKey: process.env.GHL_UNIVERSITY_API_KEY,
      name: 'WCS University',
      slug: 'university',
    }
  : null

function getUniversityLocation() {
  return UNIVERSITY
}

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

module.exports = { LOCATIONS, UNIVERSITY, getUniversityLocation, getLocationBySlug, getLocationByClubCode, getLocationById }
