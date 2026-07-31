// Shaping for the PUBLIC class board. This module is the boundary between
// internal data and an unauthenticated endpoint: whatever it returns is
// world-readable, so it builds an allowlisted object rather than deleting
// fields off the internal one.
//
// Weeks here are MONDAY-first, unlike the staff calendars (Sunday-first).
const { toIsoDate } = require('./abcTime')
const { timeRangeLabel } = require('./scheduleTimes')

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// Indexed by Date#getUTCDay(), for a rolling window where the first column is
// whatever day it happens to be rather than always Monday.
const WEEKDAY_BY_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The board shows this many days, starting today.
const BOARD_DAYS = 7
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function mondayOf(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  // getUTCDay: 0=Sun..6=Sat. Shift so Monday is 0.
  const offset = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  return toIsoDate(d)
}

// Today in club-local Pacific. The board must roll to a new week at local
// midnight Monday, not at UTC midnight.
function currentPacificDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function time12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

// Members see a first name and a last initial. No full staff names, no ids.
function shortenName(full) {
  if (!full) return null
  const parts = String(full).trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

function toPublicClass(c, opts) {
  const hhmm = String(c.event_timestamp_local || '').slice(11, 16)
  const showRange = !!(opts && opts.includeEndTime)
  return {
    time: hhmm,
    // Courts and pool show a start and an end, because "the pool is open
    // 6:00 - 7:00" is the useful fact. Group X shows a start; the class runs
    // as long as the class runs.
    time_label: showRange ? (timeRangeLabel(hhmm, c.duration_minutes) || time12(hhmm)) : time12(hhmm),
    class_name: c.class_name,
    instructor: shortenName(c.instructor_name),
    duration_minutes: c.duration_minutes,
    // Always a boolean, never undefined, so the board never has to guess.
    is_new: c.is_new === true,
    // Only present when the class type actually has one. The board makes a
    // card clickable off this, so an empty string would create a popup with
    // nothing in it.
    description: c.description ? String(c.description) : null,
  }
}

// What members should not see on the wall.
//
// Cancelled is obvious. The unbooked case is subtler and comes from real Salem
// data: ABC carries open slots with the literal employee "Unbooked Unbooked",
// and they sit at the SAME time as the real class (Mon Jul 27 had two 9:30 AM
// Barbell Strength entries, one staffed by Baley H. and one unbooked). Publishing
// both shows members a duplicate class with no instructor. A class nobody is
// assigned to teach is not something to advertise.
function isPublishable(c, opts) {
  const requireInstructor = !opts || opts.requireInstructor !== false
  const status = String(c.status || '').toLowerCase()
  if (status.includes('cancel')) return false
  if (c.unbooked === true) return false
  // Group X classes need an instructor to be worth advertising. Facility slots
  // (lap swim, open gym) legitimately have nobody assigned, so callers can opt
  // out rather than us inventing a staff name to satisfy the rule.
  if (requireInstructor && !c.instructor_name) return false
  return true
}

// Builds the rolling board window: `startIso` is the FIRST column, and the
// next days follow it. Members looking at a wall want today first and the days
// ahead of it, not a Monday that may already be four days gone.
function buildDays(startIso, classes, opts) {
  const options = opts || {}
  const count = options.dayCount || BOARD_DAYS
  const publishable = (classes || []).filter(c => isPublishable(c, options))
  const days = []

  for (let i = 0; i < count; i++) {
    const d = new Date(startIso + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    const date = toIsoDate(d)
    days.push({
      date,
      // Derived from the date, not the column index, because the window no
      // longer starts on a fixed weekday.
      weekday: WEEKDAY_BY_DOW[d.getUTCDay()],
      day_number: d.getUTCDate(),
      label: `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`,
      is_today: i === 0,
      classes: publishable
        .filter(c => String(c.event_timestamp_local || '').slice(0, 10) === date)
        .sort((a, b) => String(a.event_timestamp_local).localeCompare(String(b.event_timestamp_local)))
        .map(c => toPublicClass(c, options)),
    })
  }

  const end = new Date(startIso + 'T00:00:00Z')
  end.setUTCDate(end.getUTCDate() + count - 1)
  const endIso = toIsoDate(end)
  const s = new Date(startIso + 'T00:00:00Z')
  const rangeLabel = s.getUTCMonth() === end.getUTCMonth()
    ? `${MONTH_LABELS[s.getUTCMonth()]} ${s.getUTCDate()} - ${end.getUTCDate()}`
    : `${MONTH_LABELS[s.getUTCMonth()]} ${s.getUTCDate()} - ${MONTH_LABELS[end.getUTCMonth()]} ${end.getUTCDate()}`

  return { week_start: startIso, week_end: endIso, range_label: rangeLabel, days }
}

// Last day of a window that starts on `startIso`.
function windowEnd(startIso, dayCount) {
  const d = new Date(startIso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + (dayCount || BOARD_DAYS) - 1)
  return toIsoDate(d)
}

// Cache key for one club window of the public board, keyed on the window's
// FIRST day. Lives here rather than in the route so the admin write paths can
// invalidate without importing the public router.
function publicCacheKey(clubNumber, startIso) {
  return `gx:public:${clubNumber}:${startIso}`
}

// Every cache key a class on these dates could appear in.
//
// With a rolling window a class on date D shows up in every window starting
// D-6 through D, so clearing only D's own key would leave six stale windows
// serving the old schedule. Cheap to over-clear; expensive to under-clear.
function publicCacheKeysForDates(clubNumber, dates, dayCount) {
  const span = dayCount || BOARD_DAYS
  const keys = new Set()
  for (const d of dates || []) {
    const iso = String(d || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue
    for (let back = 0; back < span; back++) {
      const start = new Date(iso + 'T00:00:00Z')
      start.setUTCDate(start.getUTCDate() - back)
      keys.add(publicCacheKey(clubNumber, toIsoDate(start)))
    }
  }
  return [...keys]
}

module.exports = {
  mondayOf, currentPacificDate, toPublicClass, isPublishable,
  buildDays, windowEnd, BOARD_DAYS,
  publicCacheKey, publicCacheKeysForDates,
  WEEKDAY_LABELS, WEEKDAY_BY_DOW, MONTH_LABELS,
}
