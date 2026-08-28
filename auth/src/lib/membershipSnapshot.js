// Pure shaping for Analytics > Membership Snapshot. No I/O; the route fetches.
//
// One salesperson, one window, with the same window a month earlier beside it
// and a month-by-month trend underneath.
//
// The stats are lifted straight off the row that Salesperson Performance
// builds, not recomputed here — so a snapshot and the table it drills into can
// never disagree about what a Day One Book % is.

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
const STATS = [
  { key: 'newMemberUnits', label: 'New Member Units', format: 'int', betterWhen: 'up' },
  { key: 'pctOfClubTotal', label: '% of Club Total', format: 'pct', betterWhen: 'up' },
  { key: 'dayOneBookCount', label: 'Day Ones Booked', format: 'int', betterWhen: 'up' },
  { key: 'dayOneBookPct', label: 'Day One Book %', format: 'pct', betterWhen: 'up' },
  { key: 'bookOnJoinDateCount', label: 'Booked on Join Date', format: 'int', betterWhen: 'up' },
  { key: 'bookOnJoinDatePct', label: 'Booked on Join Date %', format: 'pct', betterWhen: 'up' },
  { key: 'achCount', label: 'ACH Units', format: 'int', betterWhen: 'up' },
  { key: 'achPct', label: 'ACH %', format: 'pct', betterWhen: 'up' },
  { key: 'avgNextDueAmount', label: 'Avg Next Due', format: 'money', betterWhen: 'up' },
  { key: 'avgDownPayment', label: 'Avg Down Payment', format: 'money', betterWhen: 'up' },
]

function seriesRow(r) {
  const newMembers = num(r.new_members)
  const booked = num(r.day_ones_booked)
  const completed = num(r.day_ones_completed)
  return {
    month: String(r.month_start).slice(0, 10),
    newMembers,
    dayOnesBooked: booked,
    dayOnesCompleted: completed,
    dayOnesSold: num(r.day_ones_sold),
    // Day Ones booked as a share of the members they signed. This is the
    // placeholder for the conversion metric that is still being defined, and it
    // is labelled as Book % rather than "conversion" so nobody reads it as the
    // finished thing.
    bookPct: rate(booked, newMembers),
    closeRate: rate(num(r.day_ones_sold), completed),
  }
}

/**
 * @param current  the person's row from buildReport (Salesperson), or null
 * @param prior    the same row for the previous window, or null
 * @param series   rows from analytics_salesperson_monthly()
 */
function buildMembershipSnapshot(current, prior, series, opts = {}) {
  const cur = current || {}
  const prev = prior || {}

  const stats = STATS.map(s => {
    const now = cur[s.key] ?? null
    const was = prev[s.key] ?? null
    return { ...s, value: now, prior: was, change: pctChange(now, was) }
  })

  return {
    salesperson: cur.salesperson || opts.person || null,
    club: cur.club || null,
    hasActivity: Boolean(current),
    stats,
    series: (series || []).map(seriesRow),
  }
}

module.exports = { buildMembershipSnapshot, seriesRow, STATS, rate }
