// Shaping for the PUBLIC class board. This module is the boundary between
// internal data and an unauthenticated endpoint: whatever it returns is
// world-readable, so it builds an allowlisted object rather than deleting
// fields off the internal one.
//
// Weeks here are MONDAY-first, unlike the staff calendars (Sunday-first).
const { toIsoDate } = require('./abcTime')

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
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

function toPublicClass(c) {
  const hhmm = String(c.event_timestamp_local || '').slice(11, 16)
  return {
    time: hhmm,
    time_label: time12(hhmm),
    class_name: c.class_name,
    instructor: shortenName(c.instructor_name),
    duration_minutes: c.duration_minutes,
    // Always a boolean, never undefined, so the board never has to guess.
    is_new: c.is_new === true,
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
function isPublishable(c) {
  const status = String(c.status || '').toLowerCase()
  if (status.includes('cancel')) return false
  if (c.unbooked === true) return false
  if (!c.instructor_name) return false
  return true
}

function buildWeek(mondayIso, classes) {
  const publishable = (classes || []).filter(isPublishable)
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayIso + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    const date = toIsoDate(d)
    days.push({
      date,
      weekday: WEEKDAY_LABELS[i],
      day_number: d.getUTCDate(),
      label: `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`,
      classes: publishable
        .filter(c => String(c.event_timestamp_local || '').slice(0, 10) === date)
        .sort((a, b) => String(a.event_timestamp_local).localeCompare(String(b.event_timestamp_local)))
        .map(toPublicClass),
    })
  }
  const end = new Date(mondayIso + 'T00:00:00Z')
  end.setUTCDate(end.getUTCDate() + 6)
  const endIso = toIsoDate(end)
  const s = new Date(mondayIso + 'T00:00:00Z')
  const rangeLabel = s.getUTCMonth() === end.getUTCMonth()
    ? `${MONTH_LABELS[s.getUTCMonth()]} ${s.getUTCDate()} - ${end.getUTCDate()}`
    : `${MONTH_LABELS[s.getUTCMonth()]} ${s.getUTCDate()} - ${MONTH_LABELS[end.getUTCMonth()]} ${end.getUTCDate()}`
  return { week_start: mondayIso, week_end: endIso, range_label: rangeLabel, days }
}

// Cache key for one club-week of the public board. Lives here (rather than in
// the route) so the admin write paths can invalidate a week without importing
// the public router.
function publicCacheKey(clubNumber, mondayIso) {
  return `gx:public:${clubNumber}:${mondayIso}`
}

// Every cache key touched by a set of class dates. A create or cancel must
// clear the week that class falls in, or the board keeps serving the old week
// for up to the full stale window.
function publicCacheKeysForDates(clubNumber, dates) {
  const keys = new Set()
  for (const d of dates || []) {
    const iso = String(d || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue
    keys.add(publicCacheKey(clubNumber, mondayOf(iso)))
  }
  return [...keys]
}

module.exports = {
  mondayOf, currentPacificDate, toPublicClass, buildWeek, isPublishable,
  publicCacheKey, publicCacheKeysForDates,
  WEEKDAY_LABELS, MONTH_LABELS,
}
