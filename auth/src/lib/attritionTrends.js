// Pure shaping for Analytics > Attrition Trends. No I/O; the route fetches.
//
// One SQL function returns the four raw quantities per month per segment —
// base members, members lost, monthly dues lost, monthly revenue lost — and
// every metric a reader can pick is derived from those here. Deriving in JS
// rather than in SQL keeps the ten metrics from becoming ten queries.

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

/**
 * The metrics, in the order the source tool lists them.
 *
 * `format` drives the axis and the point labels; `perMember` metrics divide by
 * members LOST, not by the base, because "avg dues lost per member" is asking
 * what the average leaver was worth, not what a leaver costs the whole club.
 */
const METRICS = [
  { key: 'attrition_pct', label: 'Attrition %', format: 'pct' },
  { key: 'lost_members', label: 'Lost Members', format: 'int' },
  { key: 'annual_dues_lost', label: 'Annual Dues Lost', format: 'money' },
  { key: 'monthly_dues_lost', label: 'Monthly Dues Lost', format: 'money' },
  { key: 'annual_revenue_lost', label: 'Annual Revenue Lost', format: 'money' },
  { key: 'monthly_revenue_lost', label: 'Monthly Revenue Lost', format: 'money' },
  { key: 'avg_annual_dues_per_member', label: 'Avg Annual Dues Lost Per Member', format: 'money' },
  { key: 'avg_monthly_dues_per_member', label: 'Avg Monthly Dues Lost Per Member', format: 'money' },
  { key: 'avg_annual_revenue_per_member', label: 'Avg Annual Revenue Lost Per Member', format: 'money' },
  { key: 'avg_monthly_revenue_per_member', label: 'Avg Monthly Revenue Lost Per Member', format: 'money' },
]

const METRIC_KEYS = new Set(METRICS.map(m => m.key))

/**
 * Every metric for one month/segment row.
 *
 * Annual figures are the monthly one times twelve — what losing this member
 * costs over the next year if nothing replaces them. That is the source tool's
 * stated definition and it is a PROJECTION, not money already missed.
 */
function metricsFor(row) {
  const members = num(row.members)
  const lost = num(row.lost_members)
  const dues = num(row.monthly_dues_lost)
  const revenue = num(row.monthly_revenue_lost)

  return {
    // A month with no base cannot have an attrition rate. Null, not zero: a
    // zero would draw the line down to the axis as though nobody left.
    attrition_pct: members ? round((lost / members) * 100, 1) : null,
    lost_members: lost,
    monthly_dues_lost: round(dues),
    annual_dues_lost: round(dues * 12),
    monthly_revenue_lost: round(revenue),
    annual_revenue_lost: round(revenue * 12),
    avg_monthly_dues_per_member: lost ? round(dues / lost) : null,
    avg_annual_dues_per_member: lost ? round((dues * 12) / lost) : null,
    avg_monthly_revenue_per_member: lost ? round(revenue / lost) : null,
    avg_annual_revenue_per_member: lost ? round((revenue * 12) / lost) : null,
  }
}

/**
 * Least-squares fit across the points, returned as its two endpoints.
 *
 * Drawn as a straight line rather than a smoothed curve on purpose: a curve
 * through noisy monthly data invites reading a wiggle as a turning point.
 * Months with no value are skipped rather than treated as zero, which would
 * drag the slope toward an event that did not happen.
 */
function trendLine(points) {
  const usable = points
    .map((p, i) => ({ i, v: p.value }))
    .filter(p => p.v !== null && p.v !== undefined && Number.isFinite(p.v))
  if (usable.length < 2) return null

  const n = usable.length
  const sumX = usable.reduce((a, p) => a + p.i, 0)
  const sumY = usable.reduce((a, p) => a + p.v, 0)
  const sumXY = usable.reduce((a, p) => a + p.i * p.v, 0)
  const sumXX = usable.reduce((a, p) => a + p.i * p.i, 0)
  const denom = n * sumXX - sumX * sumX
  if (!denom) return null

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const last = points.length - 1
  return {
    from: round(intercept, 3),
    to: round(intercept + slope * last, 3),
    slope: round(slope, 4),
  }
}

/**
 * @param rows      from analytics_attrition_trends
 * @param metric    which of METRICS to plot
 * @param opts      { segment, clubNameFor }
 *
 * Returns an Overall series (the whole selection pooled) and one series per
 * segment value, both already reduced to the chosen metric.
 *
 * OVERALL IS POOLED FROM THE RAW QUANTITIES, NEVER AVERAGED FROM THE SEGMENTS.
 * Averaging per-segment attrition rates would weight a 40-member segment the
 * same as a 4,000-member one and report a club-wide rate no club had.
 */
function buildAttritionTrends(rows, metric, opts = {}) {
  const key = METRIC_KEYS.has(metric) ? metric : 'attrition_pct'
  const def = METRICS.find(m => m.key === key)
  const nameFor = opts.clubNameFor || (s => s)
  const isClub = opts.segment === 'club'

  const months = [...new Set((rows || []).map(r => String(r.month_start).slice(0, 10)))].sort()

  // Pool the raw quantities per month first, then derive — see the note above.
  const pooled = new Map()
  for (const r of rows || []) {
    const m = String(r.month_start).slice(0, 10)
    const acc = pooled.get(m) || { members: 0, lost_members: 0, monthly_dues_lost: 0, monthly_revenue_lost: 0 }
    acc.members += num(r.members)
    acc.lost_members += num(r.lost_members)
    acc.monthly_dues_lost += num(r.monthly_dues_lost)
    acc.monthly_revenue_lost += num(r.monthly_revenue_lost)
    pooled.set(m, acc)
  }
  const overallPoints = months.map(m => ({ month: m, value: metricsFor(pooled.get(m) || {})[key] }))

  // Per-segment. Ranked by the size of the base so the biggest segments keep
  // their own line and the tail folds, rather than ranking on the metric, which
  // would let one freak month promote a segment nobody is watching.
  const { keep } = rankSegments(rows || [], 'segment', 'members')

  const bySeg = new Map()
  for (const r of rows || []) {
    const raw = String(r.segment ?? 'Unknown')
    const seg = foldSegment(raw, keep)
    const m = String(r.month_start).slice(0, 10)
    const cur = bySeg.get(seg) || new Map()
    const acc = cur.get(m) || { members: 0, lost_members: 0, monthly_dues_lost: 0, monthly_revenue_lost: 0 }
    acc.members += num(r.members)
    acc.lost_members += num(r.lost_members)
    acc.monthly_dues_lost += num(r.monthly_dues_lost)
    acc.monthly_revenue_lost += num(r.monthly_revenue_lost)
    cur.set(m, acc)
    bySeg.set(seg, cur)
  }

  const series = [...bySeg.entries()]
    .map(([seg, byMonth]) => {
      const points = months.map(m => ({ month: m, value: metricsFor(byMonth.get(m) || {})[key] }))
      return {
        key: seg,
        label: isClub ? nameFor(seg) : seg,
        points,
        trend: trendLine(points),
        // Sorted by base size so the legend order matches the ranking above.
        weight: [...byMonth.values()].reduce((a, v) => a + v.members, 0),
      }
    })
    .sort((a, b) => b.weight - a.weight || String(a.label).localeCompare(String(b.label)))

  return {
    metric: key,
    metricLabel: def.label,
    format: def.format,
    months,
    overall: { key: 'overall', label: 'Overall', points: overallPoints, trend: trendLine(overallPoints) },
    series,
    metrics: METRICS,
  }
}

module.exports = { buildAttritionTrends, metricsFor, trendLine, METRICS }
