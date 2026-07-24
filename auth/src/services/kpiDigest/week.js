// auth/src/services/kpiDigest/week.js
// The digest reports the most recent COMPLETED Monday–Sunday week.
//
// A Monday run must report the week that ENDED the day before: a run on
// Mon the 20th covers the 13th–19th, NOT the 14th–20th. (Justin corrected
// this offset explicitly during scoping.) We generalize so the window is
// correct whatever day the job actually fires: take the most recent Monday
// on-or-before "today" in Pacific, call it M, and report [M-7, M-1].
//
// All boundaries are Pacific calendar dates. We only ever produce/compare
// plain YYYY-MM-DD strings, so there is no timezone drift to reason about.
'use strict'

const TZ = 'America/Los_Angeles'

// YYYY-MM-DD for a Date, read in Pacific.
function pacificYmd(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (t) => parts.find((p) => p.type === t).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Day of week (0=Sun..6=Sat) for a Date, read in Pacific.
function pacificDow(date) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' })
    .format(date)
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd]
}

// Add whole days to a YYYY-MM-DD string, staying calendar-correct. We anchor at
// UTC noon so DST never shifts the date across a boundary.
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  base.setUTCDate(base.getUTCDate() + n)
  const yyyy = base.getUTCFullYear()
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(base.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// The completed Mon–Sun window to report, given "now" (defaults to real now).
// Returns { start, end } as YYYY-MM-DD (Monday start, Sunday end, inclusive).
function priorWeek(now = new Date()) {
  const todayYmd = pacificYmd(now)
  const dow = pacificDow(now) // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7 // Mon->0, Tue->1, ... Sun->6
  const thisMonday = addDays(todayYmd, -daysSinceMonday)
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) }
}

module.exports = { priorWeek, pacificYmd, addDays }
