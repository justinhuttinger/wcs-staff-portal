// Multi-location filter parsing.
//
// As of 2026-05-15, every report endpoint accepts location_slug as either:
//   - missing or 'all'         → all 7 WCS clubs
//   - a single slug 'salem'    → just that club (backward-compatible)
//   - a comma-separated list   → 'salem,eugene,medford' = three clubs (NEW)
//
// This util normalizes all three shapes into a single result. Routes call
// parseLocationSlugParam(req.query.location_slug) once, then:
//   - if `result.invalid`, respond 400 with { error: `Unknown location: ...` }
//   - if `result.all`, skip the location filter (or pass all 7 slugs)
//   - otherwise filter by `result.slugs`
//
// Selecting all 7 is treated as `all` so cache keys collapse.

const ALL_SLUGS = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']

const SLUG_CLUB_MAP = {
  salem: '30935',
  keizer: '31599',
  eugene: '7655',
  springfield: '31598',
  clackamas: '31600',
  milwaukie: '31601',
  medford: '32073',
}

/**
 * @param {string|undefined|null} raw value of req.query.location_slug
 * @returns {{ all: boolean, slugs: string[], invalid?: string }}
 */
function parseLocationSlugParam(raw) {
  if (raw == null) return { all: true, slugs: [...ALL_SLUGS] }
  const trimmed = String(raw).trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'all') {
    return { all: true, slugs: [...ALL_SLUGS] }
  }
  const requested = trimmed.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (requested.length === 0) return { all: true, slugs: [...ALL_SLUGS] }

  const invalid = requested.find(s => !ALL_SLUGS.includes(s))
  if (invalid) return { all: false, slugs: [], invalid }

  // Dedup + preserve canonical ordering (matches ALL_SLUGS order). This makes
  // cache keys deterministic regardless of input order.
  const set = new Set(requested)
  const canonical = ALL_SLUGS.filter(s => set.has(s))

  if (canonical.length === ALL_SLUGS.length) {
    return { all: true, slugs: [...ALL_SLUGS] }
  }
  return { all: false, slugs: canonical }
}

/**
 * Stable cache-key fragment for the parsed location filter. Identical to
 * what cache keys used pre-multi-slug when only one slug was passed: a single
 * slug returns that slug, 'all' returns 'all', multi returns sorted-joined.
 *
 * Examples:
 *   { all: true }            → 'all'
 *   { slugs: ['salem'] }     → 'salem'
 *   { slugs: ['e','salem'] } → 'eugene+salem'  (sorted, '+' separator)
 */
function locationCacheKey(parsed) {
  if (!parsed || parsed.all) return 'all'
  if (parsed.slugs.length === 1) return parsed.slugs[0]
  return parsed.slugs.join('+') // already canonically ordered by parser
}

/**
 * Intersect a parsed result with a caller's allowed slug set. Used by routes
 * whose role middleware narrows what a manager can see.
 *
 * - If allowedSlugs is null/undefined, no narrowing (caller has full access).
 * - If parsed is { all: true }, returns the allowed set as the slugs.
 * - Returns { invalid } if the caller asked for slugs they aren't allowed.
 *   (Use this to send a 403; alternatively, narrow silently — see options.)
 *
 * @param {object} parsed     output of parseLocationSlugParam
 * @param {string[]|null} allowedSlugs
 * @param {object} [opts]
 * @param {boolean} [opts.silentNarrow=false] if true, drop disallowed slugs
 *   instead of returning { invalid }. Matches the existing revenueReports
 *   resolveLocationFilter "silent narrow" behavior.
 */
function intersectWithAllowed(parsed, allowedSlugs, opts = {}) {
  if (!Array.isArray(allowedSlugs)) return parsed
  if (parsed.all) {
    return { all: false, slugs: allowedSlugs.filter(s => ALL_SLUGS.includes(s)) }
  }
  const allowedSet = new Set(allowedSlugs)
  const intersection = parsed.slugs.filter(s => allowedSet.has(s))
  if (intersection.length === parsed.slugs.length) return parsed
  if (opts.silentNarrow) {
    return { all: false, slugs: intersection }
  }
  const denied = parsed.slugs.find(s => !allowedSet.has(s))
  return { all: false, slugs: intersection, invalid: denied, denied: true }
}

module.exports = {
  ALL_SLUGS,
  SLUG_CLUB_MAP,
  parseLocationSlugParam,
  locationCacheKey,
  intersectWithAllowed,
}
