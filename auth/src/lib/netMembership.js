// Pure shaping for Analytics > Net Membership. No I/O; the route fetches.
//
// Paired bars per segment — new in, lost out — with the net beside them and the
// same window a year earlier for context.

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

const SORTS = [
  { key: 'net_desc', label: 'Top Performers' },
  { key: 'net_asc', label: 'Bottom Performers' },
  { key: 'new_desc', label: 'Most New Members' },
  { key: 'lost_desc', label: 'Most Lost Members' },
  { key: 'label', label: 'Name' },
]

function sortRows(rows, key) {
  const out = rows.slice()
  switch (key) {
    case 'net_asc': return out.sort((a, b) => a.net - b.net)
    case 'new_desc': return out.sort((a, b) => b.newMembers - a.newMembers)
    case 'lost_desc': return out.sort((a, b) => b.lostMembers - a.lostMembers)
    case 'label': return out.sort((a, b) => String(a.label).localeCompare(String(b.label)))
    default: return out.sort((a, b) => b.net - a.net)
  }
}

/**
 * @param rows from analytics_net_membership()
 * @param opts { labelFor, sort, maxSeries }
 */
function buildNetMembership(rows, opts = {}) {
  const labelFor = opts.labelFor || (v => v)

  const src = (rows || []).map(r => ({
    segment: r.segment,
    newMembers: num(r.new_members),
    lostMembers: num(r.lost_members),
    priorNew: num(r.prior_new),
    priorLost: num(r.prior_lost),
  }))

  // Ranked on GROSS activity (new + lost), not on net. A club that signed 800
  // and lost 800 nets zero but is not a small club, and folding it into Other
  // would hide the largest churn in the estate.
  const ranked = src.map(r => ({ ...r, gross: r.newMembers + r.lostMembers }))
  const { keep, other } = rankSegments(ranked, 'segment', 'gross', opts.maxSeries)

  const byKey = new Map()
  for (const r of src) {
    const seg = foldSegment(r.segment, keep)
    const prev = byKey.get(seg)
    if (prev) {
      prev.newMembers += r.newMembers
      prev.lostMembers += r.lostMembers
      prev.priorNew += r.priorNew
      prev.priorLost += r.priorLost
    } else {
      byKey.set(seg, { ...r, segment: seg })
    }
  }

  let out = [...byKey.values()].map(r => ({
    key: r.segment,
    label: labelFor(r.segment),
    newMembers: r.newMembers,
    lostMembers: r.lostMembers,
    net: r.newMembers - r.lostMembers,
    priorNew: r.priorNew,
    priorLost: r.priorLost,
    priorNet: r.priorNew - r.priorLost,
  }))
  out = sortRows(out, opts.sort)

  // Other last regardless of the sort, so it reads as a footnote rather than a
  // competitor to the named segments.
  out.sort((a, b) => (a.key === OTHER_LABEL ? 1 : b.key === OTHER_LABEL ? -1 : 0))

  const totals = out.reduce((a, r) => {
    a.newMembers += r.newMembers
    a.lostMembers += r.lostMembers
    a.priorNew += r.priorNew
    a.priorLost += r.priorLost
    return a
  }, { newMembers: 0, lostMembers: 0, priorNew: 0, priorLost: 0 })

  const net = totals.newMembers - totals.lostMembers
  const priorNet = totals.priorNew - totals.priorLost

  return {
    rows: out,
    other,
    // The widest bar on the chart, so every bar can be drawn on one shared
    // scale. Taken across new AND lost, or the two halves of a pair would be
    // measured against different rulers.
    maxBar: out.reduce((m, r) => Math.max(m, r.newMembers, r.lostMembers), 0),
    tiles: [
      { key: 'new', label: 'New Members', format: 'int', value: totals.newMembers },
      { key: 'lost', label: 'Lost Members', format: 'int', value: totals.lostMembers },
      { key: 'net', label: 'Net Members', format: 'int', value: net, signed: true },
      { key: 'priorNew', label: 'New Members Prior Year', format: 'int', value: totals.priorNew },
      { key: 'priorLost', label: 'Lost Members Prior Year', format: 'int', value: totals.priorLost },
      { key: 'priorNet', label: 'Net Members Prior Year', format: 'int', value: priorNet, signed: true },
    ],
    totals: { ...totals, net, priorNet, netYoy: pctChange(net, priorNet) },
  }
}

module.exports = { buildNetMembership, SORTS, sortRows, pctChange }
