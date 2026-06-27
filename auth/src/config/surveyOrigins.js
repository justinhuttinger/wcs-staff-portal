// Survey pages are hosted per location at wcs<loc>.app. The tour-intake webhooks
// receive early browser POSTs from these origins, so they need explicit CORS
// (mounted before the global cors in index.js) and we map the origin back to a
// location for prefires/photos that carry no GHL location id.
//
// Add a new location's survey domain here in one line.
const SURVEY_DOMAINS = {
  'wcssalem.app': 'salem',
  'wcskeizer.app': 'keizer',
  'wcseugene.app': 'eugene',
  'wcsspringfield.app': 'springfield',
  'wcsclackamas.app': 'clackamas',
  'wcsmilwaukie.app': 'milwaukie',
  'wcsmedford.app': 'medford',
}

const SURVEY_ORIGINS = new Set(Object.keys(SURVEY_DOMAINS).map(d => `https://${d}`))

// origin/referer string -> location slug (e.g. https://wcssalem.app -> salem)
function slugForOrigin(origin) {
  if (!origin) return null
  try {
    const host = new URL(origin).hostname.replace(/^www\./, '')
    return SURVEY_DOMAINS[host] || null
  } catch {
    return null
  }
}

module.exports = { SURVEY_DOMAINS, SURVEY_ORIGINS, slugForOrigin }
