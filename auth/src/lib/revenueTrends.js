// Pure shaping for Analytics > Revenue Trends. No I/O.
//
// The same revenue at two grains — annual and monthly — split by one segment.
// Each grain is its own panel with its own y-scale, because a year of revenue
// and a month of it on one axis flattens the smaller series to nothing. That is
// two charts sharing a segment, NOT one chart with two axes.

const { rankSegments, foldSegment, OTHER_LABEL } = require('./analyticsSegments')

// Annual and monthly only. Daily was dropped in migration 142: it was the bulk
// of the payload and answered a question nobody asks of this report.
const GRAINS = [
  { key: 'annual', label: 'Annual' },
  { key: 'monthly', label: 'Monthly' },
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
  // let a segment be named in the annual chart and pooled in the monthly one,
  // which reads as a data error.
  //
  // Ranked on the MONTHLY grain's totals where available: annual buckets are
  // few and coarse, monthly covers the whole range at useful resolution.
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
  if (other.length) segmentNames.push(OTHER_LABEL)

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
      // Per-panel scale. Shared across panels it would flatten monthly against
      // a year's worth of revenue.
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
