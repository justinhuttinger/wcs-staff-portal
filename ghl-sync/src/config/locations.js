require('dotenv').config();

// The club list is clubs.json, a copy of config/clubs.json at the repo root
// (edit the root file, then run `node scripts/sync-clubs.js`).
const { clubs } = require('./clubs.json');

const ACTIVE = clubs.filter(c => c.active);

const LOCATIONS = ACTIVE.map(c => ({
  id: process.env[`GHL_LOCATION_${c.envKey}`],
  apiKey: process.env[`GHL_API_KEY_${c.envKey}`],
  name: c.name,
  slug: c.slug,
  clubNumber: c.clubNumber,
})).filter(loc => loc.id && loc.apiKey); // Skip locations without configured IDs or API keys

const skipped = ACTIVE.filter(c => !LOCATIONS.some(l => l.slug === c.slug));
if (skipped.length && process.env.NODE_ENV !== 'test') {
  console.warn(`[clubs] GHL sync: skipping ${skipped.map(c => c.name).join(', ')} (missing GHL_LOCATION_<CLUB> / GHL_API_KEY_<CLUB>)`);
}

module.exports = LOCATIONS;
