// Who was on the floor while a job was open, and for how much of it.
//
// Pure: takes shifts and a window, returns names. The fetching lives in
// operandioApi and the wiring in the Problem Areas route.
//
// This exists because a job NOBODY touched has no step to name. 489 of 575
// below-standard jobs in a 30-day window are in that position, and until now
// they had nowhere to appear on a people-only report. Rostered coverage is the
// next best evidence: if one person was on for the whole window the job was
// open, the job was theirs to do.
//
// IT IS EVIDENCE, NOT PROOF, AND THE REPORT SAYS SO. A rostered shift is not
// the same as having been handed the job, which is why the bar is deliberately
// high and why a job with no clear majority is left unattributed rather than
// spread thinly across everyone who happened to be in the building.

/** Overlap of two intervals in minutes, never negative. */
function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart, bStart)
  const end = Math.min(aEnd, bEnd)
  return end <= start ? 0 : (end - start) / 60000
}

function toMs(v) {
  if (v === null || v === undefined || v === '') return null
  // Numbers pass straight through: the batch resolver carries windows as
  // milliseconds internally, and Date.parse(1756...) is NaN, which silently
  // made every job unattributable.
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isFinite(t) ? t : null
}

const fullName = (u) => {
  if (!u) return null
  const n = `${u.firstName || ''} ${u.lastName || ''}`.trim().replace(/\s+/g, ' ')
  return n === '' ? null : n
}

/**
 * The widest window worth attributing on.
 *
 * A job open for a week implicates everybody who worked that week, which names
 * people without telling anyone anything. 449 of the 489 unattributed jobs have
 * a window of 24 hours or less, so capping here keeps 92% of them and drops the
 * cases where the answer would be meaningless.
 */
const MAX_WINDOW_HOURS = 24

/** How much of the window one person must have covered to be named. */
const DEFAULT_MAJORITY_PCT = 50

/**
 * @param window  { from, to } — when the job was open
 * @param shifts  from fetchShiftsOverlapping
 * @param opts    { majorityPct, maxWindowHours }
 *
 * @returns {
 *   attributable  false when the window is unusable or nobody clears the bar
 *   reason        why not, when attributable is false
 *   people        [{ name, minutes, pct }] sorted by coverage
 *   windowMinutes
 * }
 *
 * Several people can each cover a majority — two staff on the same eight-hour
 * shift both cover 100% of it — so this returns everyone who clears the bar
 * rather than picking a single winner. A job left undone by a pair is a fact
 * about both of them.
 */
function attributeByCoverage(window, shifts, opts = {}) {
  const majorityPct = opts.majorityPct ?? DEFAULT_MAJORITY_PCT
  const maxHours = opts.maxWindowHours ?? MAX_WINDOW_HOURS

  const from = toMs(window && window.from)
  const to = toMs(window && window.to)

  if (from === null || to === null) {
    return { attributable: false, reason: 'no window on the job', people: [], windowMinutes: 0 }
  }
  // Operandio has a handful of jobs whose due_at precedes their available_from.
  // Two in the last 30 days. Treated as unusable rather than silently inverted.
  if (to <= from) {
    return { attributable: false, reason: 'window ends before it starts', people: [], windowMinutes: 0 }
  }

  const windowMinutes = (to - from) / 60000
  if (windowMinutes > maxHours * 60) {
    return {
      attributable: false,
      reason: `window longer than ${maxHours}h`,
      people: [],
      windowMinutes,
    }
  }

  // Sum per person: somebody can be rostered twice in one window (a split
  // shift), and their coverage is the total, not the longer half.
  const byPerson = new Map()
  for (const sh of shifts || []) {
    const name = fullName(sh.user)
    if (!name) continue
    const s = toMs(sh.startsAt)
    const e = toMs(sh.endsAt)
    if (s === null || e === null) continue
    const mins = overlapMinutes(from, to, s, e)
    if (mins <= 0) continue
    byPerson.set(name, (byPerson.get(name) || 0) + mins)
  }

  const people = [...byPerson.entries()]
    .map(([name, minutes]) => ({
      name,
      minutes: Math.round(minutes),
      // Capped at 100: two overlapping shifts for one person would otherwise
      // read as 140% of a window.
      pct: Math.min(100, Math.round((minutes / windowMinutes) * 1000) / 10),
    }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))

  const named = people.filter(p => p.pct >= majorityPct)

  if (named.length === 0) {
    return {
      attributable: false,
      reason: people.length ? 'nobody covered a majority of the window' : 'nobody was rostered',
      people,
      windowMinutes: Math.round(windowMinutes),
    }
  }

  return {
    attributable: true,
    reason: null,
    people: named,
    windowMinutes: Math.round(windowMinutes),
  }
}

module.exports = {
  attributeByCoverage, overlapMinutes, fullName,
  MAX_WINDOW_HOURS, DEFAULT_MAJORITY_PCT,
}

// ---------------------------------------------------------------------------
// Resolving a batch of jobs against the roster.
// ---------------------------------------------------------------------------

/** Jobs grouped by Operandio location, with the span of window they cover. */
function groupByLocation(jobs) {
  const out = new Map()
  for (const j of jobs || []) {
    const loc = j.operandio_location_id
    if (!loc) continue
    const from = toMs(j.available_from)
    const to = toMs(j.due_at)
    if (from === null || to === null || to <= from) continue
    const cur = out.get(loc) || { locationId: loc, jobs: [], min: from, max: to }
    cur.jobs.push({ ...j, _from: from, _to: to })
    cur.min = Math.min(cur.min, from)
    cur.max = Math.max(cur.max, to)
    out.set(loc, cur)
  }
  return [...out.values()]
}

/**
 * Attribute jobs nobody touched to whoever was rostered over them.
 *
 * @param jobs        below-standard jobs with NO named step
 * @param fetchShifts (locationId, from, to) => shifts — injected so this is
 *                    testable without the Operandio API, and so a caller can
 *                    cache the fetch however it likes
 * @param opts        { majorityPct, maxWindowHours, chunkDays }
 *
 * ONE FETCH PER LOCATION PER CHUNK, not per job. 489 jobs would otherwise be
 * 489 round trips to an external API on a report load.
 *
 * AN OPERANDIO OUTAGE MUST NOT BREAK THE REPORT. A failed fetch leaves that
 * location's jobs unattributed and is counted, rather than throwing: the other
 * four checks are still worth showing, and a report that vanishes when a
 * third-party API blinks is worse than one that says what it could not resolve.
 */
async function resolveUntouchedJobs(jobs, fetchShifts, opts = {}) {
  const chunkDays = opts.chunkDays ?? 7
  const groups = groupByLocation(jobs)

  const attributed = new Map()   // job id -> [{ name, pct, minutes }]
  const unresolved = []
  let fetchFailures = 0

  for (const g of groups) {
    const shifts = []
    let failed = false

    const chunkMs = chunkDays * 24 * 3600 * 1000
    for (let start = g.min; start < g.max && !failed; start += chunkMs) {
      const from = new Date(start)
      const to = new Date(Math.min(start + chunkMs, g.max))
      try {
        shifts.push(...(await fetchShifts(g.locationId, from, to) || []))
      } catch {
        failed = true
        fetchFailures++
      }
    }

    for (const j of g.jobs) {
      if (failed) {
        unresolved.push({ id: j.id, reason: 'roster unavailable' })
        continue
      }
      const res = attributeByCoverage({ from: j._from, to: j._to }, shifts, opts)
      if (res.attributable) attributed.set(j.id, res.people)
      else unresolved.push({ id: j.id, reason: res.reason })
    }
  }

  // Jobs that never made it into a group at all: no location, or no usable
  // window. Reported rather than silently absent.
  const grouped = new Set(groups.flatMap(g => g.jobs.map(j => j.id)))
  for (const j of jobs || []) {
    if (!grouped.has(j.id)) unresolved.push({ id: j.id, reason: 'no location or window on the job' })
  }

  return { attributed, unresolved, fetchFailures }
}

module.exports.groupByLocation = groupByLocation
module.exports.resolveUntouchedJobs = resolveUntouchedJobs
