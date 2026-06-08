// Per-user location scoping for report endpoints.
//
// All-location roles (marketing / corporate / admin — see canSeeAllLocations)
// may query any club or "all". Restricted roles (lead / manager) are locked to
// the clubs they're assigned to (`req.staff.location_ids`): a requested "all"
// becomes their own clubs, and any specific request is intersected down to the
// ones they're allowed (silent narrow). This mirrors the pattern already used
// by revenueReports.js so report data can never cross a club boundary the user
// isn't assigned to, regardless of what the client sends.

const { parseLocationSlugParam, intersectWithAllowed } = require('../utils/locationSlug')
const { canSeeAllLocations } = require('../middleware/role')

// A slug that matches no real club — used to force an empty result set when a
// restricted user has no assigned clubs (or requested only clubs they can't
// see), rather than silently falling back to "no filter" (= all clubs).
const NO_ACCESS_SLUG = '__no_access__'

// club name -> slug, matching ALL_SLUGS in utils/locationSlug.js
function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// The set of club slugs a (restricted) user is allowed to see, from their
// assigned location ids. Empty array = no access.
async function getUserAllowedSlugs(req) {
  const ids = req.staff?.location_ids || []
  if (!ids.length) return []
  // Lazy require so the pure scopeSlugs() core stays importable (and testable)
  // without the Supabase client / env.
  const { supabaseAdmin } = require('./supabase')
  const { data } = await supabaseAdmin.from('locations').select('name').in('id', ids)
  return (data || []).map(l => slugify(l.name)).filter(Boolean)
}

// Pure core (testable): given the parsed location_slug param, the caller's role,
// and their allowed slugs, return either { all: true } (no filter — every club)
// or { slugs: [...] } (restrict to these). Restricted roles never get { all }.
function scopeSlugs(parsed, role, allowedSlugs) {
  if (canSeeAllLocations(role)) {
    return parsed.all ? { all: true } : { slugs: parsed.slugs }
  }
  if (!allowedSlugs.length) return { slugs: [NO_ACCESS_SLUG] }
  const narrowed = intersectWithAllowed(parsed, allowedSlugs, { silentNarrow: true })
  return { slugs: narrowed.slugs.length ? narrowed.slugs : [NO_ACCESS_SLUG] }
}

// Async resolver used by routes. Throws a 400 on an unknown slug.
async function resolveScopedSlugs(req) {
  const parsed = parseLocationSlugParam(req.query.location_slug)
  if (parsed.invalid) {
    const err = new Error(`Unknown location_slug: ${parsed.invalid}`)
    err.status = 400
    throw err
  }
  const allowed = canSeeAllLocations(req.staff?.role) ? [] : await getUserAllowedSlugs(req)
  return scopeSlugs(parsed, req.staff?.role, allowed)
}

module.exports = { getUserAllowedSlugs, scopeSlugs, resolveScopedSlugs, slugify, NO_ACCESS_SLUG }
