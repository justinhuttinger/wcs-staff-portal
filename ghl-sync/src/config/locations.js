require('dotenv').config();

const LOCATIONS = [
  { id: process.env.GHL_LOCATION_SALEM,       name: 'Salem',       slug: 'salem' },
  { id: process.env.GHL_LOCATION_KEIZER,      name: 'Keizer',      slug: 'keizer' },
  { id: process.env.GHL_LOCATION_EUGENE,      name: 'Eugene',      slug: 'eugene' },
  { id: process.env.GHL_LOCATION_SPRINGFIELD, name: 'Springfield', slug: 'springfield' },
  { id: process.env.GHL_LOCATION_CLACKAMAS,   name: 'Clackamas',   slug: 'clackamas' },
  { id: process.env.GHL_LOCATION_MILWAUKIE,   name: 'Milwaukie',   slug: 'milwaukie' },
  { id: process.env.GHL_LOCATION_MEDFORD,     name: 'Medford',     slug: 'medford' },
].filter(loc => loc.id); // Skip locations without configured IDs

module.exports = LOCATIONS;
