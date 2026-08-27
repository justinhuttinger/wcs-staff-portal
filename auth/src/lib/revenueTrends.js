// Pure shaping for Analytics > Revenue Trends. No I/O.
//
// The same revenue at two grains — monthly and daily — split by one segment.
// Each grain is its own panel with its own y-scale, because a month of revenue
// and a day of it on one axis flattens the daily line to a smear. That is two
// charts sharing a segment, NOT one chart with two axes.
//
// MONTHLY IS MONTH-TO-DATE COMPARABLE (migration 143): every month is cut at
// the same day as the range end, so Aug 1-26 sits beside Jul 1-26 rather than
// beside a whole 31-day July.

const { rankSegments, foldSegment, OTHER_LABEL } = require('./analyticsSegments')

// Monthly leads because it is the trend a reader reaches for; daily sits under
// it for the detail. Annual was dropped in migration 143 — three years of bars
// answered less than thirteen comparable months do.
const GRAINS = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'daily', label: 'Daily' },
]

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param rows from analytics_revenue_trends()
 * @param opts { labelFor, maxSeries }
 */
function buildRevenueTrends(rows, opts = {}) {
  const labelFor = opts.labelFor || (v => v)

  const src = (rows || []).map(r => ({
    grain: r.grain,
    bucket: String(r.bucket).slice(0, 10),
    segment: r.segment,
    revenue: num(r.revenue),
  }))

  // Ranked ONCE across both grains, not per grain, so a segment is the same
  // colour and the same member of Other in both panels. Ranking per grain would
  // let a segment be named in the monthly chart and pooled in the daily one,
  // which reads as a data error.
  //
  // Ranked on the MONTHLY grain: it spans the widest window at useful
  // resolution, where daily only covers the recent tail.
  const rankBasis = src.filter(r => r.grain === 'monthly')
  const { keep, other } = rankSegments(
    rankBasis.length ? rankBasis : src, 'segment', 'revenue', opts.maxSeries
  )

  const folded = new Map()
  for (const r of src) {
    const seg = foldSegment(r.segment, keep)
    const k = `${r.grain}|${r.bucket}|${seg}`
    folded.set(k, (folded.get(k) || 0) + r.revenue)
  }

  const segmentNames = [...new Set([...keep])].sort((a, b) => {
    const at = rankBasis.filter(r => r.segment === a).reduce((s, r) => s + r.revenue, 0)
    const bt = rankBasis.filter(r => r.segment === b).reduce((s, r) => s + r.revenue, 0)
    return bt - at
  })
  // Only if it is not already a segment in its own right. Profit Center Group
  // has a REAL group called "Other", and pushing the fold label on top of it
  // put the same name in the legend twice, sharing one React key. The folded
  // revenue is already summed under that name by foldSegment above, so the
  // numbers were right and only the key was doubled.
  if (other.length && !segmentNames.includes(OTHER_LABEL)) segmentNames.push(OTHER_LABEL)

  const panels = GRAINS.map(g => {
    const buckets = [...new Set(src.filter(r => r.grain === g.key).map(r => r.bucket))].sort()
    const series = segmentNames.map(seg => ({
      key: seg,
      label: labelFor(seg),
      points: buckets.map(b => ({ bucket: b, revenue: folded.get(`${g.key}|${b}|${seg}`) || 0 })),
    }))
    const totals = buckets.map(b => ({
      bucket: b,
      revenue: series.reduce((s, ser) => s + (ser.points.find(p => p.bucket === b)?.revenue || 0), 0),
    }))
    return {
      key: g.key,
      label: g.label,
      buckets,
      series,
      totals,
      // Per-panel scale. Shared across panels a day's revenue would vanish
      // against a month's.
      max: totals.reduce((m, t) => Math.max(m, t.revenue), 0),
      min: totals.reduce((m, t) => Math.min(m, t.revenue), 0),
    }
  }).filter(p => p.buckets.length > 0)

  const monthly = panels.find(p => p.key === 'monthly')
  const grand = (monthly?.totals || []).reduce((s, t) => s + t.revenue, 0)

  return {
    panels,
    segments: segmentNames.map(s => ({ key: s, label: labelFor(s) })),
    other,
    tiles: [
      { key: 'total', label: 'Revenue In Range', format: 'money', value: grand },
      { key: 'bestMonth', label: 'Best Month', format: 'money',
        value: (monthly?.totals || []).reduce((m, t) => Math.max(m, t.revenue), 0) || null },
      { key: 'segments', label: 'Series Shown', format: 'int', value: segmentNames.length },
    ],
  }
}

module.exports = { buildRevenueTrends, GRAINS }
