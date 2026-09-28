require('dotenv').config();

// GHL-enabled clubs: every active club (config/clubs, loaded from public.clubs
// at boot) that has a GHL location id and token, from its Render env vars or
// from what was saved in the portal's Admin -> Clubs.
const { activeClubs, envFor } = require('./clubs');

const ACTIVE = activeClubs();

const LOCATIONS = ACTIVE.map(c => ({
  id: envFor(c, 'GHL_LOCATION_'),
  apiKey: envFor(c, 'GHL_API_KEY_'),
  name: c.name,
  slug: c.slug,
  clubNumber: c.clubNumber,
})).filter(loc => loc.id && loc.apiKey); // Skip locations without configured IDs or API keys

const skipped = ACTIVE.filter(c => !LOCATIONS.some(l => l.slug === c.slug));
if (skipped.length && process.env.NODE_ENV !== 'test') {
  console.warn(`[clubs] GHL sync: skipping ${skipped.map(c => c.name).join(', ')} (no GHL token in env or Admin -> Clubs)`);
}

module.exports = LOCATIONS;
