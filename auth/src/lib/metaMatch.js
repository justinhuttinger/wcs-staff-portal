/**
 * Small pure helpers for the Meta Conversions API user_data payload.
 *
 * They live here rather than inline in routes/metaCapi.js so they can be
 * tested without standing up the router and stubbing a Meta round trip.
 */

/**
 * Normalize a first-party visitor id before hashing.
 *
 * The browser half hands the same raw value to the pixel, which applies its
 * own trim + lowercase before hashing. Both halves have to normalize
 * identically or the same visitor hashes to two different digests and matches
 * nothing — which is silent, since Meta accepts either digest happily.
 *
 * @param {unknown} value Raw external id.
 * @returns {string} Normalized id, or '' when there is nothing usable.
 */
function normalizeExternalId(value) {
  if (value === null || value === undefined || typeof value === 'object') return ''
  return String(value).trim().toLowerCase()
}

// Order is fixed so the log column reads the same on every line and can be
// grepped or counted without parsing.
const MATCH_KEYS = [
  ['em', 'em'],
  ['ph', 'ph'],
  ['fn', 'fn'],
  ['ln', 'ln'],
  ['fbp', 'fbp'],
  ['fbc', 'fbc'],
  ['xid', 'external_id'],
  ['ip', 'client_ip_address'],
  ['ua', 'client_user_agent'],
]

/**
 * Which match keys an event actually carried, as "em=y ph=n fbp=y ...".
 *
 * Empty values are dropped from user_data rather than sent, so the fact that
 * the caller sends a field says nothing about whether it had a value. This is
 * what makes coverage answerable from the logs. Presence only — a value is
 * never logged, hashed or otherwise.
 *
 * @param {Record<string, unknown>} userData Assembled Meta user_data object.
 * @returns {string}
 */
function matchCoverage(userData) {
  const data = userData || {}
  return MATCH_KEYS
    .map(([label, key]) => `${label}=${data[key] ? 'y' : 'n'}`)
    .join(' ')
}

module.exports = { normalizeExternalId, matchCoverage }
