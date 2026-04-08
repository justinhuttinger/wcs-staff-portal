require('dotenv').config();

const LOCATIONS = [
  { id: process.env.GHL_LOCATION_SALEM,       apiKey: process.env.GHL_API_KEY_SALEM,       name: 'Salem',       slug: 'salem' },
  { id: process.env.GHL_LOCATION_KEIZER,      apiKey: process.env.GHL_API_KEY_KEIZER,      name: 'Keizer',      slug: 'keizer' },
  { id: process.env.GHL_LOCATION_EUGENE,      apiKey: process.env.GHL_API_KEY_EUGENE,      name: 'Eugene',      slug: 'eugene' },
  { id: process.env.GHL_LOCATION_SPRINGFIELD, apiKey: process.env.GHL_API_KEY_SPRINGFIELD, name: 'Springfield', slug: 'springfield' },
  { id: process.env.GHL_LOCATION_CLACKAMAS,   apiKey: process.env.GHL_API_KEY_CLACKAMAS,   name: 'Clackamas',   slug: 'clackamas' },
  { id: process.env.GHL_LOCATION_MILWAUKIE,   apiKey: process.env.GHL_API_KEY_MILWAUKIE,   name: 'Milwaukie',   slug: 'milwaukie' },
  { id: process.env.GHL_LOCATION_MEDFORD,     apiKey: process.env.GHL_API_KEY_MEDFORD,     name: 'Medford',     slug: 'medford' },
].filter(loc => loc.id && loc.apiKey); // Skip locations without configured IDs or API keys

module.exports = LOCATIONS;
