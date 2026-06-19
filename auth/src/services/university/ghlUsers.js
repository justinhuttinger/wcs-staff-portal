// WCS University — user directory for enrollment.
//
// The tool only creates + assigns practice contacts; granting University access
// and setting permissions is done by hand in GHL. So we just list the users who
// are already in the University sub-account (only they can be assigned contacts)
// using the University location token.

const { ghlFetch } = require('../ghlClient')
const { getUniversityLocation } = require('../../config/ghlLocations')

// Users in the University sub-account, sorted by name.
async function listUniversityUsers() {
  const uni = getUniversityLocation()
  if (!uni) return []
  const data = await ghlFetch('/users/', uni.apiKey, { params: { locationId: uni.id } })
  return (data.users || [])
    .filter(u => u.id && !u.deleted)
    .map(u => ({
      id: u.id,
      name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      firstName: u.firstName || null,
      lastName: u.lastName || null,
      email: u.email || null,
    }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

module.exports = { listUniversityUsers }
