// Pure shaping for Analytics > Daily Snapshot. No I/O; the route fetches.
//
// ONE DAY, AND ONLY EVER ONE DAY. The same card as Club Snapshot, read as a
// morning agenda rather than a month in progress.
//
// IT REUSES CLUB SNAPSHOT'S OWN shapeTotals AND STATS rather than defining
// daily equivalents. Every measure — joined, left, ACH %, the Day One funnel,
// PT sold against PT lost — then has exactly one definition, and a day here
// rolls up into the month there. A second set of definitions would agree today
// and drift the first time either was amended.
//
// THE COMPARISON IS YESTERDAY, NOT LAST MONTH. That changes what the numbers
// mean more than it looks: a single day is small enough that one big sale moves
// every rate, so the deltas are shown but never dressed up as a trend. The
// fourteen-day series underneath is what a trend should be read from.
//
// AVERAGE DAYS TOUR-TO-SALE IS DROPPED. It measures a gap between two dates
// that are usually in different weeks; inside a single day it is either empty
// or an artefact of whoever happened to close that morning.
//
// REVENUE ARRIVES LATE AND THE REPORT SAYS SO. abc_revenue_transactions is
// imported, currently running about two days behind, so a snapshot of TODAY
// shows $0 collected. Without a warning the report tells whoever opens it each
// morning that the club took nothing yesterday.

const { shapeTotals, STATS } = require('./clubSnapshot')

// Measured on a single day, this is a gap between dates in different weeks.
const DROPPED_STATS = new Set(['avgDaysToConversion'])

// The two stats that come from abc_revenue_transactions. New Dues does NOT:
// it is derived from the member records, which are live, so it stays real on a
// day the revenue import has not reached.
const REVENUE_STATS = new Set(['revenue', 'ptRevenue'])

// Stats that are a stock rather than a flow. A day's "members" is the count at
// close of play, so comparing it to yesterday's is a net change already
// expressed elsewhere, and showing a delta on both invites double-reading.
const STOCK_STATS = new Set(['totalMembers'])

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function r2(v) {
  return Math.round(v * 100) / 100
}

/**
 * @param current  { window, summary, pt } for the chosen day
 * @param prior    the same for the day before, or null
 * @param series   analytics_daily_series rows
 * @param opts     { day, latestRevenueDay }
 */
function buildDailySnapshot(current, prior, series, opts = {}) {
  const today = shapeTotals(current.window, current.summary, current.pt)
  const yesterday = prior ? shapeTotals(prior.window, prior.summary, prior.pt) : null

  // Declared before the stats so a revenue-backed measure can be marked as
  // having no data rather than a confident zero.
  const latest = opts.latestRevenueDay || null
  const chosenDay = opts.day || null
  const revenueStale = !!(latest && chosenDay && chosenDay > latest)

  const stats = STATS
    .filter(s => !DROPPED_STATS.has(s.key))
    .map(s => {
      // A revenue stat on a day the import has not reached is NOT zero — it is
      // unknown. Reporting $0 tells whoever opens this each morning that the
      // club took nothing, which is a different and much worse claim.
      const unavailable = revenueStale && REVENUE_STATS.has(s.key)
      const now = unavailable ? null : today[s.key]
      const before = yesterday ? yesterday[s.key] : null
      const bothNumeric = Number.isFinite(now) && Number.isFinite(before)
      return {
        ...s,
        unavailable,
        value: unavailable ? null : (now ?? null),
        prior: before ?? null,
        // A plain difference, not a percentage. On one day a base of 1 turns a
        // single extra sale into +100%, which reads as a story and is not one.
        // Never computed against an unknown.
        delta: !unavailable && bothNumeric && !STOCK_STATS.has(s.key) ? r2(now - before) : null,
      }
    })

  const days = (series || []).map(r => ({
    day: String(r.day).slice(0, 10),
    newMembers: num(r.new_members),
    lostMembers: num(r.lost_members),
    netMembers: num(r.net_members),
    newDues: r2(num(r.new_dues)),
    revenue: r2(num(r.revenue)),
    ptRevenue: r2(num(r.pt_revenue)),
    dayOnes: num(r.day_ones),
    dayOnesCompleted: num(r.day_ones_completed),
    dayOnesSold: num(r.day_ones_sold),
    ptNewSales: num(r.pt_new_sales),
    ptNewValue: r2(num(r.pt_new_value)),
    ptLostValue: r2(num(r.pt_lost_value)),
  }))

  return {
    day: chosenDay,
    stats,
    today,
    yesterday,
    days,
    latestRevenueDay: latest,
    revenueStale,
    notes: {
      revenue: revenueStale
        ? `Revenue is imported daily and currently runs to ${latest}, so Revenue and PT ` +
          'Revenue Collected show no data for this day rather than a zero. Everything else ' +
          'on this card is live.'
        : null,
      comparison:
        'Compared with the day before. A single day is small enough that one sale moves ' +
        'every rate, so read the fourteen-day chart for direction and the day for detail.',
    },
  }
}

module.exports = { buildDailySnapshot, DROPPED_STATS, STOCK_STATS, REVENUE_STATS }
