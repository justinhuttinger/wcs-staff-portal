// Campaign names in this account encode their own metadata — "Keizer
// Retargeting Campaign", "Salem 1 Year Free Campaign 2026", "Event: ESAC TDAT".
// Meta stores none of that structurally, so the filters parse the name. Same
// approach the read-only Meta Ads report already takes.

// Ordered longest-first so "Springfield" is never shadowed by a substring
// match, and aliases map the East Side brand onto its real clubs.
export const CAMPAIGN_LOCATIONS = [
  { slug: 'salem', label: 'Salem', patterns: ['salem'] },
  { slug: 'keizer', label: 'Keizer', patterns: ['keizer'] },
  { slug: 'eugene', label: 'Eugene', patterns: ['eugene'] },
  { slug: 'springfield', label: 'Springfield', patterns: ['springfield'] },
  { slug: 'clackamas', label: 'Clackamas', patterns: ['clackamas'] },
  { slug: 'milwaukie', label: 'Milwaukie', patterns: ['milwaukie', 'milwuakie'] },
  { slug: 'medford', label: 'Medford', patterns: ['medford'] },
  // ESAC is East Side Athletic Club — its own Page and audiences, so it earns
  // its own filter entry rather than being folded into a club.
  { slug: 'esac', label: 'East Side (ESAC)', patterns: ['esac', 'east side'] },
]

// Plenty of older campaigns ("Reach", "Likes", "Post: ...") carry no club name
// at all. They get their own filter entry so a location filter hides them
// without making them unreachable.
export const NO_LOCATION = '__none__'

export const CAMPAIGN_TYPES = [
  { slug: 'lead', label: 'Lead' },
  { slug: 'traffic', label: 'Traffic' },
  { slug: 'retargeting', label: 'Retargeting' },
  { slug: 'event', label: 'Event' },
  { slug: 'other', label: 'Other' },
]

export function detectLocation(name) {
  const n = (name || '').toLowerCase()
  for (const loc of CAMPAIGN_LOCATIONS) {
    if (loc.patterns.some(p => n.includes(p))) return loc.slug
  }
  return null
}

// Name wins over objective on purpose: the retargeting campaigns are all built
// on the LEADS objective, so classifying by objective would file every one of
// them under Lead and make the Retargeting filter useless.
export function classifyCampaign(campaign) {
  const n = (campaign.name || '').toLowerCase()
  if (n.includes('retarget') || n.includes('remarket')) return 'retargeting'
  if (n.startsWith('event:') || n.includes('event')) return 'event'
  if (n.includes('traffic')) return 'traffic'
  if (n.includes('lead') || n.includes('1 year free') || n.includes('test drive') || n.includes('free trial')) return 'lead'

  // Fall back to the objective only when the name says nothing.
  switch (campaign.objective) {
    case 'OUTCOME_LEADS': return 'lead'
    case 'OUTCOME_TRAFFIC': return 'traffic'
    case 'OUTCOME_ENGAGEMENT': return 'event'
    default: return 'other'
  }
}

// "Active" means switched on and heading for delivery. IN_PROCESS is included
// because it is a scheduled or still-publishing object that will deliver on its
// own — it belongs with the live ones, not the off ones. Everything else
// (paused, archived, out of budget, rejected, WITH_ISSUES) reads as inactive:
// a paused ad is not an active one, whatever its parent is doing.
const ACTIVE_STATUSES = ['ACTIVE', 'IN_PROCESS']

export function isActive(entity) {
  return ACTIVE_STATUSES.includes(entity.effective_status || entity.status)
}

export function matchesLocationFilter(campaign, filter) {
  if (filter === 'all') return true
  const detected = detectLocation(campaign.name)
  return filter === NO_LOCATION ? detected === null : detected === filter
}

export function matchesStatusFilter(entity, filter) {
  if (filter === 'all') return true
  return filter === 'active' ? isActive(entity) : !isActive(entity)
}

export const STATUS_FILTERS = [
  { slug: 'active', label: 'Active' },
  { slug: 'inactive', label: 'Inactive' },
  { slug: 'all', label: 'All' },
]

// The targeting keys this form renders as controls. Anything else a saved
// audience carries — flexible_spec interests, custom_locations radius pins,
// location_types, targeting_automation — is preserved verbatim rather than
// silently dropped, because this form cannot represent it.
const MODELLED_KEYS = [
  'geo_locations', 'age_min', 'age_max', 'genders',
  'publisher_platforms', 'custom_audiences', 'excluded_custom_audiences',
]
const MODELLED_GEO_KEYS = ['cities', 'regions', 'zips', 'countries']

export function passthroughTargeting(targeting) {
  const extra = {}
  for (const [k, v] of Object.entries(targeting || {})) {
    if (!MODELLED_KEYS.includes(k)) extra[k] = v
  }
  const geo = {}
  for (const [k, v] of Object.entries((targeting && targeting.geo_locations) || {})) {
    if (!MODELLED_GEO_KEYS.includes(k)) geo[k] = v
  }
  if (Object.keys(geo).length) extra.geo_locations = geo
  return extra
}

// Human summary of whatever this form is carrying but not showing, so the
// preserved parts of a saved audience are visible rather than invisible.
export function describePassthrough(extra) {
  const bits = []
  const flex = extra.flexible_spec || []
  const groups = flex.reduce((n, spec) => n + Object.keys(spec || {}).length, 0)
  if (groups) bits.push(`${groups} interest/behaviour group${groups === 1 ? '' : 's'}`)
  const pins = (extra.geo_locations && extra.geo_locations.custom_locations) || []
  if (pins.length) bits.push(`${pins.length} pinned radius location${pins.length === 1 ? '' : 's'}`)
  if (extra.exclusions) bits.push('audience exclusions')
  return bits
}

// Meta encodes "all genders" as [0] (or an absent key), not [1,2].
export function readGender(targeting) {
  const g = targeting && targeting.genders
  if (!Array.isArray(g) || g.length !== 1 || Number(g[0]) === 0) return 'all'
  return String(g[0])
}

export function readGeoList(geoLocations) {
  const g = geoLocations || {}
  const list = []
  for (const city of g.cities || []) {
    list.push({ type: 'city', key: city.key, name: city.name || city.key, region: city.region, radius: city.radius || 10, distance_unit: city.distance_unit || 'mile' })
  }
  for (const region of g.regions || []) list.push({ type: 'region', key: region.key, name: region.name || region.key })
  for (const zip of g.zips || []) list.push({ type: 'zip', key: zip.key, name: zip.name || zip.key })
  for (const country of g.countries || []) list.push({ type: 'country', key: country, name: country })
  return list
}
