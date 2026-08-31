// Pure shaping for Analytics > Group X. No I/O; the route fetches.
//
// TWO SIDES, AND THE GAP BETWEEN THEM IS THE REPORT FOR NOW. Headcount capture
// is only just starting, so "we counted 12 classes" means nothing without "of
// 47 scheduled". Reporting attendance alone would make a club that counted one
// class out of forty look like a club with one class.
//
// RECORDED IS NOT A SUBSET OF SCHEDULED. The one class counted so far is at a
// club with no series at all, so a class can be recorded without being on the
// schedule — an ad-hoc session, or one whose series was never set up. Coverage
// is therefore reported as two counts and their overlap, never as a simple
// ratio that assumes one contains the other.
//
// UTILISATION IS NOT CLAMPED AT 100%. The first recorded class had 11 people in
// a room set for 10. Capping would hide exactly the classes worth knowing about.
// A class with no max_attendees contributes to attendance but not to
// utilisation, rather than counting as 0% and dragging the average down.

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function r1(v) {
  return Math.round(v * 10) / 10
}

function avg(values) {
  const xs = values.filter(v => Number.isFinite(v))
  if (xs.length === 0) return null
  return r1(xs.reduce((a, b) => a + b, 0) / xs.length)
}

function pct(part, whole) {
  if (!whole) return null
  return r1((part / whole) * 100)
}

/**
 * Roll classes up by one dimension.
 *
 * Carries the class count alongside every average, because an instructor with
 * one class averaging 14 and one with thirty averaging 12 are not comparable
 * and a bare average invites exactly that comparison.
 */
function rollup(rows, keyFn, labelFn) {
  const m = new Map()
  for (const r of rows) {
    const key = keyFn(r)
    if (key === null || key === undefined) continue
    const cur = m.get(key) || {
      key,
      label: labelFn ? labelFn(r) : String(key),
      classes: 0,
      attendance: 0,
      utilisations: [],
      headcounts: [],
    }
    cur.classes += 1
    cur.attendance += num(r.headcount)
    cur.headcounts.push(num(r.headcount))
    if (r.utilisation !== null && r.utilisation !== undefined) {
      cur.utilisations.push(num(r.utilisation))
    }
    m.set(key, cur)
  }
  return [...m.values()].map(x => ({
    key: x.key,
    label: x.label,
    classes: x.classes,
    attendance: x.attendance,
    avgHeadcount: avg(x.headcounts),
    // Averaged over the classes that HAVE a capacity, not over all of them.
    avgUtilisation: avg(x.utilisations),
    utilisationSample: x.utilisations.length,
  }))
}

const bySize = (a, b) => b.attendance - a.attendance
const byKeyAsc = (a, b) => a.key - b.key

/**
 * @param attendance  analytics_groupx_attendance rows
 * @param scheduled   analytics_groupx_scheduled rows
 */
function buildGroupX(attendance, scheduled) {
  const rows = (attendance || []).map(r => ({
    slug: r.slug,
    date: String(r.class_date).slice(0, 10),
    hour: num(r.hour),
    dow: num(r.dow),
    month: String(r.month).slice(0, 10),
    className: r.class_name,
    instructor: r.instructor_name,
    headcount: num(r.headcount),
    maxAttendees: r.max_attendees === null || r.max_attendees === undefined ? null : num(r.max_attendees),
    utilisation: r.utilisation === null || r.utilisation === undefined ? null : num(r.utilisation),
    recordedBy: r.recorded_by || null,
  }))

  const sched = (scheduled || []).map(r => ({
    slug: r.slug,
    date: String(r.class_date).slice(0, 10),
    hour: num(r.hour),
    className: r.class_name,
    instructor: r.instructor_name,
  }))

  // Matched on club + date + class, not on an id: the attendance row carries an
  // ABC event id and the schedule carries a series id, and the two do not join.
  const key = x => `${x.slug}|${x.date}|${x.className}`
  const recordedKeys = new Set(rows.map(key))
  const scheduledKeys = new Set(sched.map(key))

  const scheduledAndCounted = [...scheduledKeys].filter(k => recordedKeys.has(k)).length
  const missed = sched.filter(x => !recordedKeys.has(key(x)))
  // Recorded without a matching scheduled class: ad-hoc, or a series never set
  // up. Counted rather than discarded — the attendance happened.
  const unscheduled = rows.filter(x => !scheduledKeys.has(key(x)))

  const totalAttendance = rows.reduce((a, r) => a + r.headcount, 0)
  const utilisations = rows.filter(r => r.utilisation !== null).map(r => r.utilisation)

  return {
    summary: {
      classesRecorded: rows.length,
      classesScheduled: sched.length,
      // Of the scheduled classes, how many got a headcount. Stated as its own
      // ratio because recorded is not a subset of scheduled.
      scheduledCounted: scheduledAndCounted,
      coverage: pct(scheduledAndCounted, sched.length),
      missedCount: missed.length,
      unscheduledCount: unscheduled.length,
      totalAttendance,
      avgHeadcount: avg(rows.map(r => r.headcount)),
      avgUtilisation: avg(utilisations),
      utilisationSample: utilisations.length,
      overCapacity: rows.filter(r => r.utilisation !== null && r.utilisation > 100).length,
      classTypes: new Set(rows.map(r => r.className)).size,
      instructors: new Set(rows.map(r => r.instructor)).size,
    },
    byClass: rollup(rows, r => r.className).sort(bySize),
    byInstructor: rollup(rows, r => r.instructor).sort(bySize),
    byClub: rollup(rows, r => r.slug).sort(bySize),
    // Time dimensions stay in clock order, not size order: a distribution read
    // out of sequence is not a distribution.
    byHour: rollup(rows, r => r.hour, r => `${r.hour}`).sort(byKeyAsc),
    byDow: rollup(rows, r => r.dow, r => DOW_NAMES[r.dow] || String(r.dow)).sort(byKeyAsc),
    byMonth: rollup(rows, r => r.month).sort((a, b) => a.key.localeCompare(b.key)),
    classes: rows.sort((a, b) => b.date.localeCompare(a.date) || a.hour - b.hour),
    missed: missed.sort((a, b) => b.date.localeCompare(a.date)),
    notes: {
      coverage: sched.length === 0 ? null
        : `${scheduledAndCounted} of ${sched.length} scheduled classes have a headcount. ` +
          'A class with no count is missing from every average on this page, not counted as zero.',
      unscheduled: unscheduled.length === 0 ? null
        : `${unscheduled.length} recorded ${unscheduled.length === 1 ? 'class was' : 'classes were'} ` +
          'not on the schedule — an ad-hoc session, or a series that was never set up. They are ' +
          'included in the attendance figures.',
    },
  }
}

module.exports = { buildGroupX, DOW_NAMES, rollup }
