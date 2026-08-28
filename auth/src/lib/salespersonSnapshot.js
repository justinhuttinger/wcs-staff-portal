// Pure shaping for Analytics > Membership Snapshot. No I/O; the route fetches.
//
// One salesperson, one window, compared against EITHER the same window a month
// earlier OR another person — the route decides which and passes a label, so
// this file never has to know the difference.
//
// The stats are lifted straight off the row that Salesperson Performance
// builds, not recomputed here, so a snapshot and the table it drills into can
// never disagree about what a Day One Book % is. Which means the KEYS MUST
// MATCH that row exactly: an invented key silently renders N/A forever, which
// is how achCount, achPct and avgNextDueAmount all shipped blank.

const { pctChange } = require('./snapshotWindow')

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function rate(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

// Which way is good. Colour is the only thing carrying this on the card, so it
// has to be stated rather than assumed.
//
// Day One SOLD is deliberately absent: closing a Day One is a training outcome,
// not a membership one, and it belongs to the trainer who ran it.
const STATS = [
  { key: 'newMemberUnits', label: 'New Member Units', format: 'int', betterWhen: 'up' },
  { key: 'pctOfClubTotal', label: '% of Club Total', format: 'pct', betterWhen: 'up' },
  { key: 'dayOneBookCount', label: 'Day Ones Booked', format: 'int', betterWhen: 'up' },
  { key: 'dayOneBookPct', label: 'Day One Book %', format: 'pct', betterWhen: 'up' },
  { key: 'bookOnJoinDateCount', label: 'Booked on Join Date', format: 'int', betterWhen: 'up' },
  { key: 'bookOnJoinDatePct', label: 'Booked on Join Date %', format: 'pct', betterWhen: 'up' },
  { key: 'achUnits', label: 'ACH Units', format: 'int', betterWhen: 'up' },
  { key: 'pctOnAch', label: 'ACH %', format: 'pct', betterWhen: 'up' },
  { key: 'avgNewDuesDraft', label: 'Avg New Dues Draft', format: 'money', betterWhen: 'up' },
  { key: 'totalNewDuesDraft', label: 'Total New Dues Draft', format: 'money', betterWhen: 'up' },
  { key: 'totalDownPayment', label: 'Down Payment Collected', format: 'money', betterWhen: 'up' },
  // VIPs against memberships sold, in the order Justin asked for them. Null
  // rather than zero at a club that does not collect VIPs at all — Milwaukie
  // has never recorded one, and a 0% there reads as a person underperforming
  // when it is a GHL field that was never configured.
  { key: 'vipCount', label: 'VIPs Collected', format: 'int', betterWhen: 'up' },
  { key: 'vipPct', label: 'VIP %', format: 'pct', betterWhen: 'up' },
  // Real from 2026-08-28, when the check-in stopped deleting completed rows.
  // Still null for a club with no tour on record, because every window before
  // that is empty by construction rather than by anyone's inactivity.
  { key: 'toursGiven', label: 'Tours Given', format: 'int', betterWhen: 'up' },
  { key: 'tourConversionRate', label: 'Tour Conversion', format: 'pct', betterWhen: 'up' },
  { key: 'avgDaysToConversion', label: 'Avg Days to Sign', format: 'num', betterWhen: 'down', pending: true },
]

function seriesRow(r) {
  const newMembers = num(r.new_members)
  const booked = num(r.day_ones_booked)
  return {
    month: String(r.month_start).slice(0, 10),
    newMembers,
    dayOnesBooked: booked,
    // Day Ones booked as a share of the members they signed. Can exceed 100%
    // where somebody books more intros than they sign.
    bookPct: rate(booked, newMembers),
    // The monthly series has no tour or VIP grain yet — analytics_salesperson_
    // monthly predates both — so these stay null and the panel draws a gap
    // rather than a line along zero, which would read as "none given".
    toursGiven: null,
    toursSold: null,
    avgDaysToSign: null,
  }
}

/**
 * @param current     the person's row from buildReport, or null
 * @param comparison  { label, row } — either the prior window or another person
 * @param series      rows from analytics_salesperson_monthly()
 */
function buildSalespersonSnapshot(current, comparison, series, opts = {}) {
  const cur = current || {}
  const cmp = (comparison && comparison.row) || {}

  const stats = STATS.map(s => {
    const now = cur[s.key] ?? null
    const was = cmp[s.key] ?? null
    return { ...s, value: now, prior: was, change: pctChange(now, was) }
  })

  return {
    salesperson: cur.salesperson || opts.person || null,
    club: cur.club || null,
    hasActivity: Boolean(current),
    comparisonLabel: (comparison && comparison.label) || null,
    comparingTo: (comparison && comparison.person) || null,
    stats,
    series: (series || []).map(seriesRow),
  }
}

module.exports = { buildSalespersonSnapshot, seriesRow, STATS, rate }
