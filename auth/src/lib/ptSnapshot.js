// Pure shaping for Analytics > PT Snapshot. No I/O; the route fetches.
//
// Whole club rather than one person: the Day One funnel, what new business came
// in, what went out, and the net of the two.
//
// The definitions live in migration 148 and come from PT Health, so the two
// reports agree on what a resign is and what a paid-in-full package is. The one
// place they deliberately differ is the loss side — see LOSS_BASIS below, which
// is carried through to the card so the reader is told rather than left to
// discover it by reconciling two reports.

const { pctChange } = require('./snapshotWindow')

// Stated on the card. PT Health asks ABC, member by member, whether a
// paid-in-full package still has sessions left on it and counts the spent ones
// as churn. Nothing in Supabase records that, so this report cannot: no PIF row
// has ever carried an inactive_date. Showing the RS figure as if it were the
// whole loss would flatter churn, so the basis is printed next to it.
const LOSS_BASIS =
  'Recurring service deactivations only. Paid-in-full packages that ran out of ' +
  'sessions are not counted here, because ABC only reveals that one member at a ' +
  'time. PT Health includes them, so its loss figure runs higher.'

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function rate(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

function money(v) {
  return Math.round(num(v) * 100) / 100
}

/**
 * Which way is good. Colour is the only thing carrying this on the card, so a
 * rising no-show has to be declared bad rather than assumed to be.
 *
 * Losses are `down` even though the number itself is printed positive: fewer
 * deactivations is the better month.
 */
const STATS = [
  // Counted on the APPOINTMENT date. Named the same as on Club Snapshot, so one
  // number does not travel under two names between two reports.
  { key: 'dayOnes', label: 'Day Ones on Calendar', format: 'int', betterWhen: 'up' },
  { key: 'dayOnesCompleted', label: 'Completed', format: 'int', betterWhen: 'up' },
  { key: 'dayOnesNoShow', label: 'No Show', format: 'int', betterWhen: 'down' },
  { key: 'dayOnesCancelled', label: 'Cancelled', format: 'int', betterWhen: 'down' },
  // Passed with nobody closing it out. Counted on the appointment date like the
  // rest of this block, so it is a subset of Day Ones on Calendar, not a
  // separate population. Down is better: this one is a chase list, not an
  // outcome.
  { key: 'dayOnesPending', label: 'Pending Outcome', format: 'int', betterWhen: 'down' },
  { key: 'dayOnesSold', label: 'Sold', format: 'int', betterWhen: 'up' },
  { key: 'dayOnesNoSale', label: 'No Sale', format: 'int', betterWhen: 'down' },
  { key: 'showRate', label: 'Show Rate', format: 'pct', betterWhen: 'up' },
  { key: 'closeRate', label: 'Close Rate', format: 'pct', betterWhen: 'up' },
  { key: 'newClients', label: 'New Clients', format: 'int', betterWhen: 'up' },
  { key: 'resigns', label: 'Resigns', format: 'int', betterWhen: 'up' },
  { key: 'newValue', label: 'New Revenue', format: 'money', betterWhen: 'up' },
  { key: 'lostClients', label: 'Lost Clients', format: 'int', betterWhen: 'down' },
  { key: 'lostValue', label: 'Lost Revenue', format: 'money', betterWhen: 'down' },
  { key: 'netClients', label: 'Net Clients', format: 'int', betterWhen: 'up' },
  { key: 'netValue', label: 'Net Revenue', format: 'money', betterWhen: 'up' },
]

/** One row from analytics_pt_snapshot, flattened and with the rates derived. */
function shapeTotals(r) {
  const row = r || {}
  const dayOnes = num(row.day_ones)
  const completed = num(row.day_ones_completed)
  const sold = num(row.day_ones_sold)
  const newSales = num(row.new_sales)
  const newValue = money(row.new_value)
  const lostClients = num(row.lost_count)
  const lostValue = money(row.lost_value)

  return {
    dayOnes,
    dayOnesCompleted: completed,
    dayOnesNoShow: num(row.day_ones_no_show),
    dayOnesCancelled: num(row.day_ones_cancelled),
    dayOnesScheduled: num(row.day_ones_scheduled),
    dayOnesSold: sold,
    dayOnesNoSale: num(row.day_ones_no_sale),
    // Of the ones that were meant to happen, how many did. Cancelled and
    // no-show both count against it; still-scheduled does not, because a Day One
    // in the future has not failed to happen yet.
    showRate: rate(completed, completed + num(row.day_ones_no_show) + num(row.day_ones_cancelled)),
    // Of the ones that happened, how many closed.
    closeRate: rate(sold, completed),

    newSales,
    newClients: num(row.new_clients),
    resigns: num(row.resigns),
    newRsCount: num(row.new_rs_count),
    newPifCount: num(row.new_pif_count),
    newValue,
    newRsValue: money(row.new_rs_value),
    newPifValue: money(row.new_pif_value),
    newClientValue: money(row.new_client_value),
    resignValue: money(row.resign_value),

    lostClients,
    lostValue,

    // Net follows PT Health: every sale in, every deactivation out.
    netClients: newSales - lostClients,
    netValue: money(newValue - lostValue),
  }
}

/**
 * Breakdown rows from analytics_pt_snapshot_breakdown, split by kind and sorted
 * biggest first. Empty kinds come back as empty arrays rather than being absent,
 * so the panel renders its heading and an honest "none" instead of vanishing.
 */
function shapeBreakdowns(rows) {
  const out = { noSaleReasons: [], soldTypes: [], newTypes: [], newClientTypes: [], lostReasons: [] }
  const bucket = {
    no_sale_reason: 'noSaleReasons',
    sold_type: 'soldTypes',
    new_type: 'newTypes',
    new_client_type: 'newClientTypes',
    lost_reason: 'lostReasons',
  }
  for (const r of rows || []) {
    const key = bucket[r.kind]
    if (!key) continue
    out[key].push({ label: r.label, count: num(r.cnt), value: money(r.value) })
  }
  for (const key of Object.keys(out)) {
    out[key].sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
  }
  return out
}

function seriesRow(r) {
  const dayOnes = num(r.day_ones)
  const completed = num(r.day_ones_completed)
  const sold = num(r.day_ones_sold)
  const newValue = money(r.new_value)
  const lostValue = money(r.lost_value)
  return {
    month: String(r.month_start).slice(0, 10),
    dayOnes,
    dayOnesCompleted: completed,
    dayOnesSold: sold,
    closeRate: rate(sold, completed),
    newSales: num(r.new_sales),
    newClients: num(r.new_clients),
    newValue,
    newRsValue: money(r.new_rs_value),
    newPifValue: money(r.new_pif_value),
    lostCount: num(r.lost_count),
    // POSITIVE, even though it is money going out: TrendPanel scales from zero
    // and would draw a negative point below its own plot area. New-against-lost
    // is shown as two positive lines, and the net is read from the stat card.
    lostValue,
    netValue: money(newValue - lostValue),
    netClients: num(r.new_sales) - num(r.lost_count),
  }
}

/**
 * @param current    one row from analytics_pt_snapshot, or null
 * @param prior      the same window a month earlier, or null
 * @param breakdown  rows from analytics_pt_snapshot_breakdown
 * @param series     rows from analytics_pt_monthly
 * @param opts.pending summarised pending-outcome Day Ones for this window and
 *                     the comparison one — see lib/dayOnePending. Supplied
 *                     separately because it is keyed on the appointment date
 *                     while analytics_pt_snapshot keys its own counts the same
 *                     way but computes them from status alone.
 */
function buildPtSnapshot(current, prior, breakdown, series, opts = {}) {
  const cur = shapeTotals(current)
  const was = prior ? shapeTotals(prior) : {}

  // Injected rather than derived: it comes from analytics_day_one_pending, not
  // from the snapshot row. Left null when the caller supplies nothing, so a
  // report that has not been wired up shows a blank rather than a false zero.
  const pending = opts.pending || null
  cur.dayOnesPending = pending ? pending.total : null
  if (prior) was.dayOnesPending = pending && pending.priorTotal != null ? pending.priorTotal : null

  const stats = STATS.map(s => {
    const now = cur[s.key] ?? null
    const before = was[s.key] ?? null
    return { ...s, value: now, prior: before, change: pctChange(now, before) }
  })

  return {
    hasActivity: Boolean(current) && (cur.dayOnes > 0 || cur.newSales > 0 || cur.lostClients > 0),
    comparisonLabel: opts.comparisonLabel || null,
    // The chase list behind the Pending Outcome stat: who is outstanding and
    // for how long. A count says 62 are open; this says which trainer.
    pending: pending && {
      total: pending.total,
      oldestDays: pending.oldestDays,
      byTrainer: pending.byTrainer,
      list: pending.list,
    },
    stats,
    totals: cur,
    breakdown: shapeBreakdowns(breakdown),
    lossBasis: LOSS_BASIS,
    series: (series || []).map(seriesRow),
  }
}

module.exports = { buildPtSnapshot, shapeTotals, shapeBreakdowns, seriesRow, STATS, LOSS_BASIS, rate }
