// Pure shaping for Analytics > Member Journey. No I/O; the route fetches.
//
// The x-axis is MONTH OF MEMBERSHIP, not calendar month: every member's first
// month is 0, so a member who joined last year and one who joined last week are
// compared at the same point in their own life as a member.
//
// The SQL returns one row per tenure month per spend group, with the visit
// figures repeated on each. This splits that back into the curves the report
// draws and folds the long tail of spend groups.

const { rankSegments, foldSegment } = require('./analyticsSegments')

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(v, dp = 2) {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

// Stated on the report. The source tool pairs check-ins with an "Avg Duration"
// line; nothing in our data records how long a visit lasted. abc_calendar_events
// has a duration, but that is the length of a booked APPOINTMENT and exists only
// for members with one, so using it would answer a different question about a
// different population.
const NO_DURATION =
  'Visit duration is not shown: nothing in the check-in feed records how long a ' +
  'member stayed. The only duration we hold is the length of a booked appointment, ' +
  'which exists solely for members who booked one.'

/**
 * @param rows from analytics_member_journey
 *
 * Returns the tenure axis, the two whole-member curves, and one spend series
 * per profit centre group.
 */
function buildMemberJourney(rows, opts = {}) {
  const all = rows || []
  const months = [...new Set(all.map(r => num(r.tenure_month)))].sort((a, b) => a - b)

  // The visit figures repeat across a tenure month's spend rows, so they are
  // read once per month rather than summed — summing would multiply them by the
  // number of groups that happened to have revenue.
  const byMonth = new Map()
  for (const r of all) {
    const t = num(r.tenure_month)
    if (!byMonth.has(t)) {
      byMonth.set(t, {
        tenureMonth: t,
        memberMonths: num(r.member_months),
        members: num(r.members),
        avgCheckins: r.avg_checkins === null ? null : round(num(r.avg_checkins)),
        avgSpend: r.avg_spend === null ? null : round(num(r.avg_spend)),
      })
    }
  }
  const cohort = months.map(m => byMonth.get(m))

  // Spend groups, capped and tailed the same way every other report caps them.
  const spendRows = all.filter(r => r.group_name)
  const { keep } = rankSegments(
    spendRows.map(r => ({ segment: r.group_name, value: Math.abs(num(r.group_spend)) })),
    'segment', 'value'
  )

  const bySeries = new Map()
  for (const r of spendRows) {
    const label = foldSegment(r.group_name, keep)
    const t = num(r.tenure_month)
    const cur = bySeries.get(label) || new Map()
    cur.set(t, round(num(cur.get(t) || 0) + num(r.group_spend)))
    bySeries.set(label, cur)
  }

  const spend = [...bySeries.entries()]
    .map(([label, byT]) => ({
      key: label,
      label,
      points: months.map(m => ({
        month: m,
        // A group with no revenue in a tenure month really did take nothing,
        // so zero is the honest value here rather than a gap.
        value: round(num(byT.get(m))),
      })),
      total: [...byT.values()].reduce((a, v) => a + v, 0),
    }))
    .sort((a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label)))

  const series = key => ({
    key,
    label: key === 'avgCheckins' ? 'Avg Check-ins' : 'Avg Spend',
    points: cohort.map(c => ({ month: c.tenureMonth, value: c[key] })),
  })

  return {
    months,
    cohort,
    checkins: series('avgCheckins'),
    spendTotal: series('avgSpend'),
    spend,
    noDuration: NO_DURATION,
    // The cohort thins with every month: a member who joined three months ago
    // cannot contribute a month-12 figure. Carried so the reader can see which
    // end of the curve is thinly evidenced.
    maxMemberMonths: cohort.reduce((m, c) => Math.max(m, c.memberMonths), 0),
  }
}

module.exports = { buildMemberJourney, NO_DURATION }
