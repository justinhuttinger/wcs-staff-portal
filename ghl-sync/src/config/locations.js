require('dotenv').config();

const LOCATIONS = [
  { id: process.env.GHL_LOCATION_SALEM,       apiKey: process.env.GHL_API_KEY_SALEM,       name: 'Salem',       slug: 'salem',       dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_SALEM },
  { id: process.env.GHL_LOCATION_KEIZER,      apiKey: process.env.GHL_API_KEY_KEIZER,      name: 'Keizer',      slug: 'keizer',      dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_KEIZER },
  { id: process.env.GHL_LOCATION_EUGENE,      apiKey: process.env.GHL_API_KEY_EUGENE,      name: 'Eugene',      slug: 'eugene',      dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_EUGENE },
  { id: process.env.GHL_LOCATION_SPRINGFIELD, apiKey: process.env.GHL_API_KEY_SPRINGFIELD, name: 'Springfield', slug: 'springfield', dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_SPRINGFIELD },
  { id: process.env.GHL_LOCATION_CLACKAMAS,   apiKey: process.env.GHL_API_KEY_CLACKAMAS,   name: 'Clackamas',   slug: 'clackamas',   dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_CLACKAMAS },
  { id: process.env.GHL_LOCATION_MILWAUKIE,   apiKey: process.env.GHL_API_KEY_MILWAUKIE,   name: 'Milwaukie',   slug: 'milwaukie',   dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_MILWAUKIE },
  { id: process.env.GHL_LOCATION_MEDFORD,     apiKey: process.env.GHL_API_KEY_MEDFORD,     name: 'Medford',     slug: 'medford',     dayOneWebhookUrl: process.env.GHL_WEBHOOK_DAYONE_MEDFORD },
].filter(loc => loc.id && loc.apiKey); // Skip locations without configured IDs or API keys

module.exports = LOCATIONS;
