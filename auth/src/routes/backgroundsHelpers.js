// Pure helpers for the backgrounds route, split out so they can be unit-tested
// without Supabase. Same shape as trainerAvailabilityHelpers.js.

// SVG is excluded deliberately: it is an image type that can carry script, and
// these files are served to other people's browsers from a signed URL.
const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
// Personal uploads per user. Without a cap nothing in this system ever deletes
// an image and the bucket grows without bound.
const MAX_PER_USER = 3

function baseMime(m) {
  return typeof m === 'string' ? m.split(';')[0].trim().toLowerCase() : ''
}

function isAllowedMime(m) {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME, baseMime(m))
}

function extForMime(m) {
  return ALLOWED_MIME[baseMime(m)] || null
}

/**
 * Which object names to delete so that adding one more stays within `max`.
 * Oldest first. A file with no created_at sorts oldest, on the grounds that a
 * file we cannot date is the one we would rather lose.
 */
function toPrune(files, max) {
  const sorted = [...(files || [])].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
  )
  const excess = sorted.length - (max - 1)
  return excess > 0 ? sorted.slice(0, excess).map(f => f.name) : []
}

module.exports = { ALLOWED_MIME, MAX_UPLOAD_BYTES, MAX_PER_USER, isAllowedMime, extForMime, toPrune }
