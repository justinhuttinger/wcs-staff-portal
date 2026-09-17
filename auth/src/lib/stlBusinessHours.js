// Validation for the Business-Hours Speed to Lead window, one row per club in
// stl_business_hours_config. speed_to_lead_business() reads the table at query
// time, so a saved change applies to every STL figure the next time it is
// computed — including past leads, which are re-clamped to the NEW window.

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/

/** "11:00" / "11:00:00" -> "11:00", or null when not a valid HH:MM. */
function normalizeTime(v) {
  const m = TIME_RE.exec(String(v || '').trim())
  return m ? `${m[1]}:${m[2]}` : null
}

/**
 * Validate a PUT body. Returns { value } or { error }.
 * active_days uses Postgres DOW: 0 = Sunday ... 6 = Saturday.
 */
function parseWindow(body) {
  const b = body || {}
  const start = normalizeTime(b.window_start)
  const end = normalizeTime(b.window_end)
  if (!start) return { error: 'window_start must be HH:MM' }
  if (!end) return { error: 'window_end must be HH:MM' }
  // Same-day windows only: business_seconds clamps each calendar day to
  // [start, end], so an overnight window would count nothing.
  if (start >= end) return { error: 'window_start must be before window_end' }
  if (!Array.isArray(b.active_days)) return { error: 'active_days must be an array' }
  const days = [...new Set(b.active_days.map(Number))]
  if (days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return { error: 'active_days must be 0-6' }
  if (days.length === 0) return { error: 'pick at least one day' }
  return { value: { window_start: start, window_end: end, active_days: days.sort((a, c) => a - c) } }
}

module.exports = { normalizeTime, parseWindow }
