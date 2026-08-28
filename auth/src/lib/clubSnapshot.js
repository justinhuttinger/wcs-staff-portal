// Pure shaping for Analytics > Club Snapshot. No I/O; the route fetches.
//
// The whole club in one card, not one person — the club-wide twin of
// Salesperson Snapshot. Three sources feed it, and the split is deliberate:
//
//   COUNTS come from analytics_topline_window   members, joined, left, net,
//                                               revenue collected, check-ins.
//   RATES come from buildReport                 ACH %, average dues, Day One
//                                               book rates, VIPs, tours.
//   TRAINING comes from analytics_pt_snapshot   the Day One funnel and PT sold
//                                               against PT lost.
//
// The training half is READ FROM THE SAME FUNCTION PT Snapshot uses rather than
// recomputed, so the two reports cannot disagree about a close rate.
//
// Deliberately absent: buildReport's own new-member COUNT. It filters to new
// agreements attributable to a salesperson, so it lands near but not on
// Topline's figure. Printing both would put two numbers labelled "new members"
// on one card and invite the reader to decide which is wrong. Rates and
// averages do not add up against the counts, so mixing those is safe; a second
// count is not.

const { pctChange } = require('./snapshotWindow')

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function money(v) {
  return Math.round(num(v) * 100) / 100
}

function rate(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

const STATS = [
  { key: 'totalMembers', label: 'Members', format: 'int', betterWhen: 'up' },
  { key: 'newMembers', label: 'Joined', format: 'int', betterWhen: 'up' },
  { key: 'lostMembers', label: 'Left', format: 'int', betterWhen: 'down' },
  { key: 'netMembers', label: 'Net Members', format: 'int', betterWhen: 'up' },
  { key: 'newDues', label: 'New Dues', format: 'money', betterWhen: 'up' },
  { key: 'revenue', label: 'Revenue', format: 'money', betterWhen: 'up' },
  // Money that came through the till against TRAINING, which is a different
  // thing from the value of PT sold below: one is collected, the other is
  // contracted. Labelled apart so the card never shows two "PT Revenue".
  { key: 'ptRevenue', label: 'PT Revenue Collected', format: 'money', betterWhen: 'up' },
  { key: 'checkins', label: 'Check-ins', format: 'int', betterWhen: 'up' },
  { key: 'pctOnAch', label: 'ACH %', format: 'pct', betterWhen: 'up' },
  { key: 'avgNewDuesDraft', label: 'Avg New Dues Draft', format: 'money', betterWhen: 'up' },
  { key: 'dayOneBookCount', label: 'Day Ones Booked', format: 'int', betterWhen: 'up' },
  { key: 'dayOneBookPct', label: 'Day One Book %', format: 'pct', betterWhen: 'up' },
  { key: 'bookOnJoinDatePct', label: 'Booked on Join Date %', format: 'pct', betterWhen: 'up' },
  // VIPs against memberships sold. The denominator is buildReport's new member
  // units, which is the figure Justin means by "memberships sold" — deliberately
  // not Topline's joined count above, because a percentage has to divide by the
  // same population its numerator was credited against.
  { key: 'vipCount', label: 'VIPs Collected', format: 'int', betterWhen: 'up' },
  { key: 'vipPct', label: 'VIP %', format: 'pct', betterWhen: 'up' },
  // Real from 2026-08-28, when the check-in stopped deleting completed rows.
  // Null rather than zero where nothing is on record: "no tours given" and
  // "tours were not being kept yet" are different findings, and a zero would
  // report the second as the first.
  { key: 'toursGiven', label: 'Tours Given', format: 'int', betterWhen: 'up' },
  { key: 'tourConversionRate', label: 'Tour Conversion', format: 'pct', betterWhen: 'up' },
  // Days from a tour to that person joining. Fewer is better: it measures how
  // long somebody sat on the decision, not how many signed.
  { key: 'avgDaysToConversion', label: 'Avg Days Tour to Sale', format: 'num', betterWhen: 'down' },

  // Training. Same definitions as PT Snapshot, read from the same function.
  { key: 'dayOnes', label: 'Day Ones', format: 'int', betterWhen: 'up' },
  { key: 'dayOneShowRate', label: 'Day One Show Rate', format: 'pct', betterWhen: 'up' },
  { key: 'dayOneCloseRate', label: 'Day One Close Rate', format: 'pct', betterWhen: 'up' },
  // The VALUE OF PT SOLD, not money collected — see PT Revenue Collected above.
  // Lost is recurring-service deactivations only: no paid-in-full package has
  // ever carried an inactive_date, so a spent package cannot be seen from here.
  { key: 'newPtRevenue', label: 'New PT Revenue', format: 'money', betterWhen: 'up' },
  { key: 'lostPtRevenue', label: 'Lost PT Revenue', format: 'money', betterWhen: 'down' },
  { key: 'netPtRevenue', label: 'Net PT Revenue', format: 'money', betterWhen: 'up' },
]

/**
 * @param window  one row from analytics_topline_window
 * @param summary the `summary` object from buildReport, or null
 * @param pt      one row from analytics_pt_snapshot, or null
 */
function shapeTotals(window, summary, pt) {
  const w = window || {}
  const s = summary || {}
  const p = pt || {}
  const newMembers = num(w.new_members)
  const lostMembers = num(w.lost_members)

  return {
    totalMembers: num(w.total_members),
    newMembers,
    lostMembers,
    netMembers: newMembers - lostMembers,
    newDues: money(w.new_dues),
    revenue: money(w.revenue),
    ptRevenue: money(w.pt_revenue),
    // Check-in coverage has been incomplete in the past, so an absent feed is
    // reported as absent rather than as a quiet zero.
    checkins: w.has_checkin_data === false ? null : num(w.checkins),

    pctOnAch: s.pctOnAch ?? null,
    avgNewDuesDraft: s.avgNewDuesDraft ?? null,
    totalNewDuesDraft: s.totalNewDuesDraft ?? null,
    dayOneBookCount: s.dayOneBookCount ?? null,
    dayOneBookPct: s.dayOneBookPct ?? null,
    bookOnJoinDateCount: s.bookOnJoinDateCount ?? null,
    bookOnJoinDatePct: s.bookOnJoinDatePct ?? null,

    // Taken from the same summary as the other rates, so the club card and the
    // Salesperson Performance total below it cannot disagree.
    vipCount: s.vipCount ?? null,
    vipPct: s.vipPct ?? null,

    toursGiven: s.toursGiven ?? null,
    tourConversionRate: s.tourConversionRate ?? null,
    avgDaysToConversion: s.avgDaysToConversion ?? null,

    // --- training ---------------------------------------------------------
    dayOnes: num(p.day_ones),
    // Of the Day Ones that were MEANT to happen, how many did. Still-scheduled
    // ones are excluded: a Day One in the future has not failed to happen yet,
    // and counting it would make every show rate sag as a month filled up.
    dayOneShowRate: rate(
      num(p.day_ones_completed),
      num(p.day_ones_completed) + num(p.day_ones_no_show) + num(p.day_ones_cancelled)
    ),
    // Of the ones that happened, how many closed.
    dayOneCloseRate: rate(num(p.day_ones_sold), num(p.day_ones_completed)),
    newPtRevenue: money(p.new_value),
    lostPtRevenue: money(p.lost_value),
    netPtRevenue: money(num(p.new_value) - num(p.lost_value)),
  }
}

/**
 * One month. The membership half comes from analytics_membership_monthly and
 * the training half is merged in from analytics_pt_monthly by the route, so a
 * row here carries both.
 */
function seriesRow(r) {
  const newMembers = num(r.new_members)
  const lost = num(r.lost_members)
  const ptNew = money(r.new_value)
  const ptLost = money(r.lost_value)
  return {
    month: String(r.month_start).slice(0, 10),
    totalMembers: num(r.total_members),
    newMembers,
    // POSITIVE, even though these are members leaving: TrendPanel scales from
    // zero and would draw a negative point below its own plot area. Joined
    // against left is shown as two positive lines, and the net is on the card.
    lostMembers: lost,
    netMembers: newMembers - lost,
    newDues: money(r.new_dues),
    revenue: money(r.revenue),
    ptRevenue: money(r.pt_revenue),
    checkins: r.has_checkin_data === false ? null : num(r.checkins),

    dayOnes: num(r.day_ones),
    dayOnesCompleted: num(r.day_ones_completed),
    dayOnesSold: num(r.day_ones_sold),
    dayOneCloseRate: rate(num(r.day_ones_sold), num(r.day_ones_completed)),
    // Both POSITIVE: TrendPanel scales from zero and would draw a negative
    // point below its own plot area, where it would simply vanish. The net
    // keeps its sign on the stat card.
    newPtRevenue: ptNew,
    lostPtRevenue: ptLost,
    netPtRevenue: money(ptNew - ptLost),
  }
}

function buildClubSnapshot(current, prior, series, opts = {}) {
  const cur = shapeTotals(current.window, current.summary, current.pt)
  const was = prior ? shapeTotals(prior.window, prior.summary, prior.pt) : {}

  const stats = STATS.map(s => {
    const now = cur[s.key] ?? null
    const before = was[s.key] ?? null
    return {
      ...s,
      value: now,
      prior: before,
      change: pctChange(now, before),
      // Nothing recorded in either window: say so on the card rather than
      // drawing a dash the reader has to interpret.
      pending: now === null && before === null,
    }
  })

  return {
    hasActivity: cur.totalMembers > 0 || cur.newMembers > 0,
    comparisonLabel: opts.comparisonLabel || null,
    stats,
    totals: cur,
    series: (series || []).map(seriesRow),
  }
}

module.exports = { buildClubSnapshot, shapeTotals, seriesRow, STATS }
