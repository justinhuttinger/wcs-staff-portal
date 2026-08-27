// Pure shaping for Analytics > Membership Trends. No I/O; the route fetches.
//
// Two stacked charts over the same months: total members (a stock) on top, new
// members (a flow) below, both split by one segment.
//
// The headline pair is YTD against the SAME span of the prior year, not against
// the whole prior year — comparing eight months to twelve would show a fall
// every August.

const { rankSegments, foldSegment, OTHER_LABEL } = require('./analyticsSegments')

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pctChange(now, prior) {
  const a = Number(now)
  const b = Number(prior)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null
  return Math.round(((a - b) / b) * 1000) / 10
}

/**
 * Total members is a LEVEL: the YTD headline is the latest month, never a sum.
 * Summing it would count a member once per month they were a member.
 * New members is a FLOW and is summed.
 */
function summarise(months, isCurrentYear, isPriorYearToDate) {
  let latestTotal = null
  let latestMonth = null
  let priorTotal = null
  let newSum = 0
  let priorNewSum = 0

  for (const m of months) {
    if (isCurrentYear(m.month)) {
      newSum += m.newMembers
      if (latestMonth === null || m.month > latestMonth) {
        latestMonth = m.month
        latestTotal = m.totalMembers
      }
    }
    if (isPriorYearToDate(m.month)) {
      priorNewSum += m.newMembers
      priorTotal = m.totalMembers
    }
  }
  return { latestTotal, latestMonth, priorTotal, newSum, priorNewSum }
}

/**
 * @param rows      from analytics_membership_trends()
 * @param opts      { asOf: 'YYYY-MM-DD', labelFor: fn, maxSeries }
 */
function buildMembershipTrends(rows, opts = {}) {
  const labelFor = opts.labelFor || (v => v)
  const asOf = String(opts.asOf || '')
  const year = Number(asOf.slice(0, 4))
  const monthNo = Number(asOf.slice(5, 7))

  const src = (rows || []).map(r => ({
    month: String(r.month_start).slice(0, 10),
    segment: r.segment,
    totalMembers: num(r.total_members),
    newMembers: num(r.new_members),
  }))

  // Ranked on TOTAL MEMBERS, not new members: the top chart is the one a reader
  // anchors on, and a segment that is large but slow-growing must not be folded
  // into Other because a small fast-growing one out-ranked it below.
  const { keep, other } = rankSegments(src, 'segment', 'totalMembers', opts.maxSeries)

  // Fold, then re-aggregate — several folded segments share the Other line.
  const byKey = new Map()
  for (const r of src) {
    const seg = foldSegment(r.segment, keep)
    const k = `${r.month}|${seg}`
    const prev = byKey.get(k)
    if (prev) {
      prev.totalMembers += r.totalMembers
      prev.newMembers += r.newMembers
    } else {
      byKey.set(k, { month: r.month, segment: seg, totalMembers: r.totalMembers, newMembers: r.newMembers })
    }
  }

  const folded = [...byKey.values()]
  const months = [...new Set(folded.map(r => r.month))].sort()

  const segmentNames = [...new Set(folded.map(r => r.segment))]
  // Other always sorts last, so it never takes a lead colour from a real segment.
  segmentNames.sort((a, b) => {
    if (a === OTHER_LABEL) return 1
    if (b === OTHER_LABEL) return -1
    const at = folded.filter(r => r.segment === a).reduce((s, r) => s + r.totalMembers, 0)
    const bt = folded.filter(r => r.segment === b).reduce((s, r) => s + r.totalMembers, 0)
    return bt - at
  })

  const lookup = new Map(folded.map(r => [`${r.month}|${r.segment}`, r]))
  const series = segmentNames.map(seg => ({
    key: seg,
    label: labelFor(seg),
    points: months.map(month => {
      const hit = lookup.get(`${month}|${seg}`)
      return {
        month,
        totalMembers: hit ? hit.totalMembers : 0,
        newMembers: hit ? hit.newMembers : 0,
      }
    }),
  }))

  // Totals across all segments, per month — the "overall line" the source
  // dashboard draws over the top.
  const overall = months.map(month => {
    const at = folded.filter(r => r.month === month)
    return {
      month,
      totalMembers: at.reduce((s, r) => s + r.totalMembers, 0),
      newMembers: at.reduce((s, r) => s + r.newMembers, 0),
    }
  })

  const inCurrent = (m) => Number(m.slice(0, 4)) === year && Number(m.slice(5, 7)) <= monthNo
  const inPrior = (m) => Number(m.slice(0, 4)) === year - 1 && Number(m.slice(5, 7)) <= monthNo
  const s = summarise(overall, inCurrent, inPrior)

  return {
    months,
    series,
    overall,
    other,
    tiles: [
      { key: 'totalMembers', label: 'Total Members', format: 'int', value: s.latestTotal },
      { key: 'totalMembersPrior', label: 'Total Members Prior Year', format: 'int', value: s.priorTotal },
      { key: 'totalMembersYoy', label: 'Total Members YOY', format: 'pct', value: pctChange(s.latestTotal, s.priorTotal), signed: true },
      { key: 'newMembers', label: 'New Members YTD', format: 'int', value: s.newSum },
      { key: 'newMembersPrior', label: 'New Members Prior YTD', format: 'int', value: s.priorNewSum },
      { key: 'newMembersYoy', label: 'New Members YOY', format: 'pct', value: pctChange(s.newSum, s.priorNewSum), signed: true },
    ],
  }
}

module.exports = { buildMembershipTrends, pctChange }
