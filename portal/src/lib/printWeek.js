// Building a printable week from a week's worth of scheduled events.
//
// The printed sheet is deliberately NOT the on-screen calendar. Three
// differences, all of them requested:
//
//  * Monday to Sunday, not Sunday to Saturday. weekGrid.startOfWeek is
//    Sunday-anchored to match the staff calendars, so this file has its own
//    anchor rather than quietly changing that one out from under them.
//  * No dates on the sheet. It is printed as "the schedule", posted on a wall,
//    and left up while the pattern holds. A date on it makes it look stale the
//    following Monday even when nothing has changed.
//  * A week is still CHOSEN, because the sheet is usually printed ahead --
//    next week's grid, run off on Friday. So dates decide which events get
//    pulled; they just do not get printed.

export const PRINT_DAY_LABELS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]

// Monday of the week containing `d`, local time.
//
// getDay() is 0=Sun..6=Sat, so Sunday has to walk back six days rather than
// forward one. Getting this wrong puts Sunday's classes on a sheet a week
// early, which is exactly the sort of thing nobody notices until it is on a
// wall.
export function startOfPrintWeek(d) {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const dow = out.getDay()
  out.setDate(out.getDate() - (dow === 0 ? 6 : dow - 1))
  return out
}

// What must never reach a printed schedule.
//
// Cancelled is obvious. `unbooked` is the subtle one and mirrors isPublishable
// in auth/src/lib/groupXPublic.js: ABC carries open slots with the literal
// employee "Unbooked Unbooked" sitting at the SAME time as the real class, so
// a sheet that keeps them prints every staffed class twice -- once with an
// instructor and once without.
//
// requireInstructor is opt-out for the same reason it is there: lap swim and
// open gym legitimately have nobody assigned, and dropping them would print an
// empty pool schedule.
export function isPrintable(ev, opts) {
  const requireInstructor = !opts || opts.requireInstructor !== false
  const status = String(ev.status || '').toLowerCase()
  if (status.includes('cancel')) return false
  if (ev.unbooked === true) return false
  if (requireInstructor && !ev.instructor_name) return false
  return true
}

// "YYYY-MM-DD[T ]HH:mm" → minutes since midnight. Mirrors
// weekGrid.parseLocalTimestamp's tolerance of both separators: cached rows use
// 'T', live ABC rows use a space, and a parse that accepts only one silently
// drops half the week.
function parseLocal(ts) {
  if (!ts) return null
  const m = String(ts).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return null
  return { date: m[1], hour: parseInt(m[2], 10), min: parseInt(m[3], 10) }
}

function toISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function time12(hour, min) {
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hh = hour % 12 || 12
  return `${hh}:${String(min).padStart(2, '0')} ${ampm}`
}

// Seven day buckets, Monday first, each sorted by start time.
//
// Days with nothing on them are KEPT and returned empty. On a wall-mounted
// grid an absent Sunday column reads as "we forgot Sunday"; an empty one
// headed "Sunday" reads as "nothing on Sunday", which is the true statement.
// (This is the opposite of the reports rule, where a club with no data is
// omitted entirely -- there, a row is a claim about a club; here, a column is
// a day of the week and the week always has seven.)
export function buildPrintWeek(monday, events, opts) {
  const options = opts || {}
  const byDate = new Map()
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    byDate.set(toISO(d), [])
  }

  for (const ev of events || []) {
    if (!isPrintable(ev, options)) continue
    const p = parseLocal(ev.event_timestamp_local)
    if (!p) continue
    const bucket = byDate.get(p.date)
    // An event outside the chosen Mon-Sun window is not ours to print. This
    // happens routinely: the Group X fetch pads its range for the ABC
    // timezone edge, so it returns a little more than the week asked for.
    if (!bucket) continue
    bucket.push({
      ...ev,
      _startMin: p.hour * 60 + p.min,
      time_label: time12(p.hour, p.min),
    })
  }

  const dates = [...byDate.keys()]
  return dates.map((date, i) => ({
    label: PRINT_DAY_LABELS[i],
    // Carried for keys and debugging, never rendered onto the sheet.
    date,
    events: byDate.get(date).sort((a, b) => {
      if (a._startMin !== b._startMin) return a._startMin - b._startMin
      // Two classes at the same time need a stable order or the sheet
      // reshuffles between two prints of the same week.
      return String(a.class_name || '').localeCompare(String(b.class_name || ''))
    }),
  }))
}

// Label for the week PICKER, not for the sheet. The picker is the one place
// dates belong: choosing "next week" is meaningless without them.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function printWeekLabel(monday) {
  const end = new Date(monday)
  end.setDate(end.getDate() + 6)
  const a = `${MONTHS[monday.getMonth()]} ${monday.getDate()}`
  const b = monday.getMonth() === end.getMonth()
    ? `${end.getDate()}`
    : `${MONTHS[end.getMonth()]} ${end.getDate()}`
  return `${a} - ${b}, ${end.getFullYear()}`
}
