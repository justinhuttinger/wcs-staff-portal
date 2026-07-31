// Start/end time handling.
//
// Staff think in "6:00 to 7:00", not "6:00 for 60 minutes". Duration is still
// what gets stored, because that is what both ABC and the board work in, so
// this is the one place that converts between the two.

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/

// How far ahead an open-ended series is written. Occurrences are topped up
// nightly, so this only has to outrun how far anyone looks at the board.
const OPEN_ENDED_HORIZON_DAYS = 90

function parseHm(value) {
  const m = TIME_RE.exec(String(value || ''))
  if (!m) return null
  return { hours: parseInt(m[1], 10), minutes: parseInt(m[2], 10) }
}

function toMinutes(value) {
  const hm = parseHm(value)
  return hm === null ? null : hm.hours * 60 + hm.minutes
}

// Minutes between start and end. An end at or before the start is rejected
// rather than silently wrapping to the next day, which would quietly create a
// 23 hour "class".
function durationBetween(startTime, endTime) {
  const s = toMinutes(startTime)
  const e = toMinutes(endTime)
  if (s === null) throw new Error('start time must be HH:mm')
  if (e === null) throw new Error('end time must be HH:mm')
  if (e === s) throw new Error('the end time must be after the start time')
  if (e < s) throw new Error('the end time must be after the start time, events cannot run past midnight')
  return e - s
}

// "06:00" + 90 -> "07:30". Clamped at 23:59 so a late event cannot roll into
// the next day and appear on the wrong column of the board.
function addMinutes(startTime, minutes) {
  const s = toMinutes(startTime)
  if (s === null) return null
  const total = Math.min(s + (minutes || 0), 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function time12(hhmm) {
  const hm = parseHm(hhmm)
  if (!hm) return null
  const suffix = hm.hours >= 12 ? 'PM' : 'AM'
  const h12 = hm.hours % 12 === 0 ? 12 : hm.hours % 12
  return `${h12}:${String(hm.minutes).padStart(2, '0')} ${suffix}`
}

// "6:00 - 7:00 AM" when both ends share a meridiem, "11:30 AM - 12:30 PM" when
// they do not. Dropping the repeated AM/PM buys real width on a TV column.
function timeRangeLabel(startTime, durationMinutes) {
  const start = time12(startTime)
  if (!start) return null
  const endTime = addMinutes(startTime, durationMinutes)
  const end = endTime ? time12(endTime) : null
  if (!end) return start
  const startMer = start.slice(-2)
  const endMer = end.slice(-2)
  return startMer === endMer
    ? `${start.slice(0, -3)} - ${end}`
    : `${start} - ${end}`
}

module.exports = {
  OPEN_ENDED_HORIZON_DAYS,
  parseHm, toMinutes, durationBetween, addMinutes, time12, timeRangeLabel,
}
