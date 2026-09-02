// Pure expansion of a recurring Group X series into individual occurrences.
// No I/O — every ABC write decision is made from this list, so it is worth
// testing hard.
//
// Dates are walked in UTC purely as calendar arithmetic; the emitted
// timestamp_local carries the club-local wall-clock time verbatim. That is why
// a series spanning a DST change keeps its 6:00 AM start on both sides: we
// never convert, we just re-attach the same wall time to each date.
const { toIsoDate } = require('./abcTime')

// Each occurrence is a real write to a live club calendar, so the fan-out is
// capped. 200 covers a full year of a 3-day-a-week class with room to spare.
const MAX_OCCURRENCES = 200

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/

function expandSeries({ weekdays, start_time, starts_on, ends_on }) {
  if (!Array.isArray(weekdays) || weekdays.length === 0) {
    throw new Error('pick at least one day of the week')
  }
  if (weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('weekdays must be integers 0-6 (0 = Sunday)')
  }
  if (!DATE_RE.test(starts_on) || !DATE_RE.test(ends_on)) {
    throw new Error('starts_on and ends_on must be YYYY-MM-DD')
  }
  if (ends_on < starts_on) throw new Error('the end date must not be before the start date')

  const m = TIME_RE.exec(String(start_time || ''))
  if (!m) throw new Error('start_time must be HH:mm')
  const wall = `${m[1]}:${m[2]}:${m[4] || '00'}`

  const want = new Set(weekdays)
  const out = []
  const cursor = new Date(starts_on + 'T00:00:00Z')
  const last = new Date(ends_on + 'T00:00:00Z')

  while (cursor <= last) {
    if (want.has(cursor.getUTCDay())) {
      const date = toIsoDate(cursor)
      out.push({ date, timestamp_local: `${date} ${wall}` })
      if (out.length > MAX_OCCURRENCES) {
        // Finish counting so the message states the real total rather than
        // just "more than 200", which is not actionable.
        let n = out.length
        const probe = new Date(cursor)
        for (;;) {
          probe.setUTCDate(probe.getUTCDate() + 1)
          if (probe > last) break
          if (want.has(probe.getUTCDay())) n++
        }
        throw new Error(`that range makes ${n} classes, which is over the ${MAX_OCCURRENCES} limit. Shorten the date range.`)
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

// Which ABC classes belong to a series.
//
// ABC returns no series link on a class, so membership is inferred from shape:
// same class type, same instructor, same wall-clock start, on one of the
// series' weekdays, inside its live date range.
//
// This is the ONLY definition of that judgement. DELETE /series/:id used to
// carry its own copy inline; a second copy is how the two drift apart.

// The end of a series' live range.
//
// An open-ended series has ends_on NULL (migration 099) and records how far it
// has actually been written in materialized_through. Reading ends_on directly
// yields null, and every date comparison against null is false — which is
// exactly how a cancel silently orphaned 4 Medford classes on 2026-08-28.
function seriesWindow(series) {
  return {
    start: series.starts_on,
    end: series.ends_on || series.materialized_through || null,
  }
}

function matchesSeries(event, series) {
  if (!event || !series || series.canceled_at) return false

  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String(event.event_timestamp_local || ''))
  // An unparseable timestamp is unknown, not a match. Never guess membership.
  if (!m) return false
  const date = m[1]
  const wall = `${m[2]}:${m[3]}`

  if (event.event_type_id !== series.event_type_id) return false
  if (event.employee_id !== series.employee_id) return false
  if (wall !== String(series.start_time).slice(0, 5)) return false

  const weekday = new Date(date + 'T00:00:00Z').getUTCDay()
  if (!(series.weekdays || []).includes(weekday)) return false

  const { start, end } = seriesWindow(series)
  if (start && date < start) return false
  if (end && date > end) return false
  return true
}

// A shape can legitimately hit two live series. Returning either one would
// rewrite the wrong classes, so say it is ambiguous and let the caller degrade
// to a single-occurrence edit.
function findSeriesForEvent(event, seriesList) {
  const hits = (seriesList || []).filter(s => matchesSeries(event, s))
  if (hits.length === 0) return null
  if (hits.length > 1) return { series: null, ambiguous: true }
  return { series: hits[0], ambiguous: false }
}

module.exports = { expandSeries, MAX_OCCURRENCES, matchesSeries, seriesWindow, findSeriesForEvent }
