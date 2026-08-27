// Pure shaping for Analytics > Revenue by Profit Center. No I/O.
//
// One stacked bar per row (a club by default), segmented by profit centre
// group. The groups come from abc_profit_center_groups, so this file never
// decides what "Dues" means — it only decides how to draw it.

const { OTHER_LABEL } = require('./analyticsSegments')

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const SORTS = [
  { key: 'total_desc', label: 'Top Performers' },
  { key: 'total_asc', label: 'Bottom Performers' },
  { key: 'label', label: 'Name' },
]

/**
 * @param rows from analytics_revenue_by_profit_center()
 * @param opts { labelFor, sort }
 */
function buildRevenueByProfitCenter(rows, opts = {}) {
  const labelFor = opts.labelFor || (v => v)

  const src = (rows || []).map(r => ({
    viewKey: r.view_key,
    group: r.group_name,
    order: num(r.sort_order),
    revenue: num(r.revenue),
  }))

  // Group order is the SQL sort_order, not size, so a group keeps the same
  // position and colour in every bar and between reloads. Ranking segments by
  // size here would repaint the stack whenever a club's mix shifted.
  const groupOrder = new Map()
  for (const r of src) {
    if (!groupOrder.has(r.group)) groupOrder.set(r.group, r.order)
    else groupOrder.set(r.group, Math.min(groupOrder.get(r.group), r.order))
  }
  const groups = [...groupOrder.entries()]
    .sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([g]) => g)

  const byRow = new Map()
  for (const r of src) {
    if (!byRow.has(r.viewKey)) byRow.set(r.viewKey, new Map())
    const m = byRow.get(r.viewKey)
    m.set(r.group, (m.get(r.group) || 0) + r.revenue)
  }

  let out = [...byRow.entries()].map(([viewKey, m]) => {
    const values = {}
    let total = 0
    for (const g of groups) {
      const v = m.get(g) || 0
      values[g] = v
      total += v
    }
    return { key: viewKey, label: labelFor(viewKey), values, total }
  })

  switch (opts.sort) {
    case 'total_asc': out.sort((a, b) => a.total - b.total); break
    case 'label': out.sort((a, b) => String(a.label).localeCompare(String(b.label))); break
    default: out.sort((a, b) => b.total - a.total)
  }

  const groupTotals = groups.map(g => ({
    group: g,
    revenue: out.reduce((s, r) => s + (r.values[g] || 0), 0),
  }))
  const grandTotal = groupTotals.reduce((s, g) => s + g.revenue, 0)

  const ranked = groupTotals.filter(g => g.group !== OTHER_LABEL)
    .slice().sort((a, b) => b.revenue - a.revenue)

  return {
    groups,
    rows: out,
    groupTotals,
    grandTotal,
    // Widest bar, so every stack is drawn against one ruler.
    maxTotal: out.reduce((m, r) => Math.max(m, r.total), 0),
    tiles: [
      { key: 'total', label: 'Total Revenue', format: 'money', value: grandTotal },
      { key: 'top', label: 'Largest Group', format: 'text', value: ranked[0]?.group ?? null,
        sub: ranked[0] ? ranked[0].revenue : null },
      { key: 'bottom', label: 'Smallest Group', format: 'text', value: ranked[ranked.length - 1]?.group ?? null,
        sub: ranked[ranked.length - 1] ? ranked[ranked.length - 1].revenue : null },
    ],
  }
}

module.exports = { buildRevenueByProfitCenter, SORTS }
