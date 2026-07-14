// Pure, dependency-free helpers for the lapsed check-in admin routes. Kept
// separate so they can be unit-tested without loading express/supabase.
//
// Mirrors the Pacific-day math + tier boundaries from the plan's dashboard SQL:
//   activity_date = coalesce(nullif(left(last_check_in_timestamp,10),''), sign_date, begin_date, since_date)
//   days_since = (now() at time zone 'America/Los_Angeles')::date - activity_date
//   tier10: days_since between 10 and 20
//   tier21: days_since between 21 and 29
//   tier30: days_since >= 30

const PACIFIC = 'America/Los_Angeles'

// Extract a YYYY-MM-DD prefix from any date/timestamp-ish string. Returns null
// for null/empty/malformed input.
function toDateOnly(text) {
  if (!text || typeof text !== 'string') return null
  const m = text.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

// coalesce(nullif(left(last_check_in_timestamp,10),''), sign_date, begin_date, since_date)
function resolveActivityDate(member) {
  return (
    toDateOnly(member.last_check_in_timestamp) ||
    toDateOnly(member.sign_date) ||
    toDateOnly(member.begin_date) ||
    toDateOnly(member.since_date) ||
    null
  )
}

// Today's Pacific calendar date as YYYY-MM-DD.
function pacificToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

// Whole-day difference between two YYYY-MM-DD strings (today - activityDate).
// Both are treated as UTC-midnight anchors purely for stable day math (matches
// the pattern used by ghl-sync's lapsedTagging.js).
function daysBetween(activityDateStr, todayStr) {
  if (!activityDateStr || !todayStr) return null
  const activity = new Date(`${activityDateStr}T00:00:00Z`)
  const today = new Date(`${todayStr}T00:00:00Z`)
  if (Number.isNaN(activity.getTime()) || Number.isNaN(today.getTime())) return null
  return Math.floor((today.getTime() - activity.getTime()) / 86400000)
}

// days_since for a member row, relative to `now` (Date, defaults to current time).
function daysSinceForMember(member, now = new Date()) {
  const activityDate = resolveActivityDate(member)
  if (!activityDate) return null
  return daysBetween(activityDate, pacificToday(now))
}

// Bucket a days_since value into a dashboard tier key, or null if not lapsed.
function bucketTier(days) {
  if (days == null) return null
  if (days >= 30) return 'tier30'
  if (days >= 21) return 'tier21'
  if (days >= 10) return 'tier10'
  return null
}

// Day-range for a drill-down :tier route param ('10' | '21' | '30').
// Returns { min, max } (max === null means unbounded) or null for an invalid tier.
function tierDayRange(tierParam) {
  const t = String(tierParam)
  if (t === '10') return { min: 10, max: 20 }
  if (t === '21') return { min: 21, max: 29 }
  if (t === '30') return { min: 30, max: null }
  return null
}

function inTierRange(days, range) {
  if (days == null || !range) return false
  if (days < range.min) return false
  if (range.max != null && days > range.max) return false
  return true
}

// Validate + normalize the PUT /types body's `excluded` array: must be an
// array of strings; entries are trimmed and empty/duplicate entries dropped.
function normalizeExcludedInput(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'excluded must be an array of strings' }
  const out = []
  const seen = new Set()
  for (const entry of input) {
    if (typeof entry !== 'string') return { ok: false, error: 'excluded must contain only strings' }
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return { ok: true, list: out }
}

module.exports = {
  toDateOnly,
  resolveActivityDate,
  pacificToday,
  daysBetween,
  daysSinceForMember,
  bucketTier,
  tierDayRange,
  inTierRange,
  normalizeExcludedInput,
}
