// Pure shaping for Analytics > Membership Snapshot. No I/O; the route fetches.
//
// The whole club, not one salesperson — the club-wide twin of Salesperson
// Snapshot. Two sources feed it, and the split between them is deliberate:
//
//   COUNTS come from analytics_topline_window   members, joined, left, net,
//                                               revenue, check-ins.
//   RATES come from buildReport                 ACH %, average dues, Day One
//                                               book rates.
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
  { key: 'ptRevenue', label: 'PT Revenue', format: 'money', betterWhen: 'up' },
  { key: 'checkins', label: 'Check-ins', format: 'int', betterWhen: 'up' },
  { key: 'pctOnAch', label: 'ACH %', format: 'pct', betterWhen: 'up' },
  { key: 'avgNewDuesDraft', label: 'Avg New Dues Draft', format: 'money', betterWhen: 'up' },
  { key: 'dayOneBookCount', label: 'Day Ones Booked', format: 'int', betterWhen: 'up' },
  { key: 'dayOneBookPct', label: 'Day One Book %', format: 'pct', betterWhen: 'up' },
  { key: 'bookOnJoinDatePct', label: 'Booked on Join Date %', format: 'pct', betterWhen: 'up' },
  // Real data now, but only from the day the tour product starts posting
  // completions. Until then the stat is PENDING rather than zero: "no tours
  // given" and "tours not being recorded yet" are different findings, and a
  // zero would report the second as the first.
  { key: 'toursGiven', label: 'Tours Given', format: 'int', betterWhen: 'up' },
  { key: 'tourConversionRate', label: 'Tour Conversion', format: 'pct', betterWhen: 'up' },
]

/**
 * @param window  one row from analytics_topline_window
 * @param summary the `summary` object from buildReport, or null
 * @param tours   { given, joined } counted from tour_intakes, or null
 */
function shapeTotals(window, summary, tours) {
  const w = window || {}
  const s = summary || {}
  const t = tours || {}
  const newMembers = num(w.new_members)
  const lostMembers = num(w.lost_members)
  const given = num(t.given)

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

    toursGiven: given || null,
    tourConversionRate: given ? rate(num(t.joined), given) : null,
  }
}

function seriesRow(r) {
  const newMembers = num(r.new_members)
  const lost = num(r.lost_members)
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
  }
}

function buildClubMembershipSnapshot(current, prior, series, opts = {}) {
  const cur = shapeTotals(current.window, current.summary, current.tours)
  const was = prior ? shapeTotals(prior.window, prior.summary, prior.tours) : {}

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

module.exports = { buildClubMembershipSnapshot, shapeTotals, seriesRow, STATS }
