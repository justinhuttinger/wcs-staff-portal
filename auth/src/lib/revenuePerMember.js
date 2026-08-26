// Pure shaping for Analytics > Revenue Per Member. No I/O; the route fetches.
//
// Turns the (month, segment, revenue, members) rows from
// analytics_revenue_per_member() into two series and five headline figures.
//
// Every period figure is the MEAN OF THE MONTHLY RATES, not total revenue over
// total members. A quarter's revenue divided by a quarter's worth of
// member-months would answer a different question, and the two diverge whenever
// membership moves during the period.
//
// Periods are whole months only. A month still in progress has a full month's
// members against a partial month's revenue, which drags the rate down for a
// reason that has nothing to do with performance.

function num(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round2(v) {
  return v === null ? null : Math.round(v * 100) / 100
}

function pctChange(current, prior) {
  if (current === null || prior === null || prior === 0) return null
  return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10
}

function rate(revenue, members) {
  if (!members) return null
  return revenue / members
}

/** Mean of the per-month rates across the named months. Months we hold no data for are skipped, not counted as zero. */
function meanRate(byMonth, months) {
  const rates = months
    .map(m => byMonth.get(m))
    .filter(Boolean)
    .map(t => rate(t.revenue, t.members))
    .filter(r => r !== null)
  if (rates.length === 0) return null
  return rates.reduce((a, b) => a + b, 0) / rates.length
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** The whole months of the calendar quarter containing `ym`, up to and including it. */
function quarterMonths(ym) {
  const [y, m] = ym.split('-').map(Number)
  const firstOfQuarter = Math.floor((m - 1) / 3) * 3 + 1
  const out = []
  for (let mm = firstOfQuarter; mm <= m; mm++) out.push(`${y}-${String(mm).padStart(2, '0')}`)
  return out
}

function lastNMonths(ym, n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(ym, -i))
  return out
}

/**
 * @param rows      (month_start, segment, revenue, members) from the RPC
 * @param opts      { months: how many to chart, maxSegments }
 */
function buildRevenuePerMember(rows, opts = {}) {
  const maxSegments = opts.maxSegments || 6
  const chartMonths = opts.months || 25

  const byMonth = new Map()          // month -> { revenue, members }
  const bySegment = new Map()        // segment -> Map(month -> { revenue, members })
  const segmentTotals = new Map()

  for (const r of (rows || [])) {
    const month = String(r.month_start).slice(0, 7)
    const revenue = num(r.revenue) || 0
    const members = num(r.members) || 0
    const segment = r.segment || 'Unknown'

    if (!byMonth.has(month)) byMonth.set(month, { revenue: 0, members: 0 })
    const t = byMonth.get(month)
    t.revenue += revenue
    t.members += members

    if (!bySegment.has(segment)) bySegment.set(segment, new Map())
    bySegment.get(segment).set(month, { revenue, members })
    segmentTotals.set(segment, (segmentTotals.get(segment) || 0) + members)
  }

  const allMonths = [...byMonth.keys()].sort()
  // The most recent month is dropped when the caller says it is still running:
  // a full month of members against a partial month of revenue is not a rate.
  const months = allMonths.slice(-chartMonths)
  const anchor = months[months.length - 1] || null

  // Segments ranked by member-months across the whole window, so a line keeps
  // its identity as the window scrolls.
  const ranked = [...segmentTotals.entries()]
    .filter(([name]) => name !== 'Unknown')
    .sort((a, b) => b[1] - a[1])
  const kept = ranked.slice(0, maxSegments).map(([name]) => name)

  const totals = months.map(month => {
    const t = byMonth.get(month) || { revenue: 0, members: 0 }
    return {
      month,
      revenue: round2(t.revenue),
      members: t.members,
      revenuePerMember: round2(rate(t.revenue, t.members)),
    }
  })

  const series = kept.map(name => {
    const src = bySegment.get(name) || new Map()
    return {
      name,
      points: months.map(month => {
        const t = src.get(month)
        return {
          month,
          // A segment with nobody in it that month has no rate — null leaves a
          // gap in the line rather than dropping it to zero.
          value: t ? round2(rate(t.revenue, t.members)) : null,
          members: t ? t.members : 0,
        }
      }),
    }
  })

  const kpis = anchor ? (() => {
    const thisQuarter = quarterMonths(anchor)
    const priorYearQuarter = thisQuarter.map(m => shiftMonth(m, -12))
    // The quarter before this one, taken as the three months preceding its
    // first month so a part-finished quarter is compared against a whole one.
    const firstOfThis = thisQuarter[0]
    const priorQuarter = [shiftMonth(firstOfThis, -3), shiftMonth(firstOfThis, -2), shiftMonth(firstOfThis, -1)]

    const last12 = lastNMonths(anchor, 12)
    const prior12 = last12.map(m => shiftMonth(m, -12))

    const q = meanRate(byMonth, thisQuarter)
    const qPy = meanRate(byMonth, priorYearQuarter)
    const qPrior = meanRate(byMonth, priorQuarter)
    const y = meanRate(byMonth, last12)
    const yPrior = meanRate(byMonth, prior12)

    return {
      currentQuarter: round2(q),
      currentQuarterMonths: thisQuarter,
      vsPriorYearQuarter: pctChange(q, qPy),
      vsPriorQuarter: pctChange(q, qPrior),
      last12Months: round2(y),
      vsPriorYear12Months: pctChange(y, yPrior),
      // How many of the twelve had a partner a year earlier, so a short
      // comparison is visible rather than implied.
      comparable12: last12.filter(m => byMonth.has(shiftMonth(m, -12))).length,
    }
  })() : null

  return {
    months,
    totals,
    series,
    segments: kept,
    foldedSegments: Math.max(0, ranked.length - kept.length),
    anchor,
    kpis,
  }
}

module.exports = {
  buildRevenuePerMember, quarterMonths, lastNMonths, shiftMonth, meanRate, pctChange, rate,
}
