// Lowercased WCS location name -> ABC club number. The locations table does not
// carry the club number, so ABC-scoped queries (e.g. abc_employees) map a
// location name through here. Built from config/clubs.
const { CLUBS } = require('./clubs')

const NAME_TO_CLUB = Object.fromEntries(CLUBS.map(c => [c.name.toLowerCase(), c.clubNumber]))

function clubNumberForLocationName(name) {
  if (!name) return null
  return NAME_TO_CLUB[name.trim().toLowerCase()] || null
}

module.exports = { clubNumberForLocationName, NAME_TO_CLUB }
