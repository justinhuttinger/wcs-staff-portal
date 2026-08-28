// Pure shaping for Analytics > Trainer Snapshot. No I/O; the route fetches.
//
// One trainer, one window, compared against EITHER the same window a month
// earlier OR another trainer — the route decides which and passes a label.
//
// The metric definitions are NOT redefined here: the row comes from
// analytics_trainer_performance and is shaped by buildRow in trainerPerformance,
// so a snapshot and the table it drills into can never disagree.

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

function round1(v) {
  return v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10
}

/**
 * Every stat on the card, paired with its comparison value.
 *
 * `betterWhen` says which direction is good, because a reader cannot be
 * expected to know that a rising cancellation rate is bad while a rising close
 * rate is good — and colour is the only thing carrying that here.
 *
 * "Day Ones" is what the trainer was GIVEN, not what they booked. Trainers
 * service intros; the front desk books them. Labelling this "booked" credited
 * trainers with somebody else's work.
 */
const STATS = [
  { key: 'completedSessions', label: 'Sessions', format: 'int', betterWhen: 'up' },
  { key: 'uniqueClients', label: 'Clients', format: 'int', betterWhen: 'up' },
  { key: 'ptHours', label: 'PT Hours', format: 'num', betterWhen: 'up' },
  { key: 'avgSessionMinutes', label: 'Avg Session Minutes', format: 'int', betterWhen: 'flat' },
  { key: 'cancellationRate', label: 'Cancellation Rate', format: 'pct', betterWhen: 'down' },
  { key: 'memberMonths', label: 'Months w/ Trainer', format: 'num', betterWhen: 'up' },
  { key: 'dayOnesBooked', label: 'Day Ones', format: 'int', betterWhen: 'up' },
  { key: 'dayOnesCompleted', label: 'Day Ones Completed', format: 'int', betterWhen: 'up' },
  { key: 'dayOnesSold', label: 'Day Ones Sold', format: 'int', betterWhen: 'up' },
  { key: 'closeRate', label: 'Close Rate', format: 'pct', betterWhen: 'up' },
  { key: 'closeAmount', label: 'PT Close Amount', format: 'money', betterWhen: 'up' },
  // The same money, split by what was actually sold. These two sum to
  // closeAmount above; the split is credited to the same commission employee,
  // so it cannot disagree with the total sitting beside it.
  { key: 'closeAmountRs', label: 'Close: Recurring', format: 'money', betterWhen: 'up' },
  { key: 'closeAmountPif', label: 'Close: Paid in Full', format: 'money', betterWhen: 'up' },
  // What went the other way. Attributed to the SERVICE employee: losing a
  // client happens to whoever was training them, not to whoever sold the
  // package. Recurring services only — see migration 150.
  { key: 'lostClients', label: 'Clients Lost', format: 'int', betterWhen: 'down' },
  { key: 'lostValue', label: 'Lost Revenue', format: 'money', betterWhen: 'down' },
  { key: 'netValue', label: 'Net Revenue', format: 'money', betterWhen: 'up' },
]

// Stated on the card, for the same reason PT Snapshot states it: paid-in-full
// packages that simply ran out of sessions are not counted as a loss, because
// ABC only reveals that one member at a time.
const LOSS_BASIS =
  'Recurring service deactivations only. Paid-in-full packages that ran out of ' +
  'sessions are not counted, because ABC only reveals that one member at a time.'

function seriesRow(r) {
  const completed = num(r.completed_sessions)
  const cancelled = num(r.cancelled_sessions)
  const dayOnes = num(r.day_ones)
  const dayOnesCompleted = num(r.day_ones_completed)
  return {
    month: String(r.month_start).slice(0, 10),
    completedSessions: completed,
    cancelledSessions: cancelled,
    uniqueClients: num(r.unique_clients),
    ptHours: round1(num(r.pt_minutes) / 60),
    cancellationRate: rate(cancelled, completed + cancelled),
    // Day Ones this trainer SERVICED, and what became of them.
    dayOnes,
    dayOnesCompleted,
    dayOnesSold: num(r.day_ones_sold),
    dayOnesCancelled: num(r.day_ones_cancelled),
    dayOnesNoShow: num(r.day_ones_no_show),
    closeRate: rate(num(r.day_ones_sold), dayOnesCompleted),
    closeAmount: Math.round(num(r.close_amount) * 100) / 100,
    closeAmountRs: Math.round(num(r.close_amount_rs) * 100) / 100,
    closeAmountPif: Math.round(num(r.close_amount_pif) * 100) / 100,
    lostClients: num(r.lost_count),
    // POSITIVE, even though it is money going out: TrendPanel scales from zero
    // and would draw a negative point below its own plot area. Won-against-lost
    // is shown as two positive lines, and the net is read from the stat card.
    lostValue: Math.round(num(r.lost_value) * 100) / 100,
    netValue: Math.round((num(r.close_amount) - num(r.lost_value)) * 100) / 100,
  }
}

/**
 * @param current     the person's row from buildTrainerPerformance, or null
 * @param comparison  { label, row } — either the prior window or another trainer
 * @param series      rows from analytics_trainer_monthly()
 */
function buildTrainerSnapshot(current, comparison, series, opts = {}) {
  const cur = current || {}
  const cmp = (comparison && comparison.row) || {}

  const stats = STATS.map(s => {
    const now = cur[s.key] ?? null
    const was = cmp[s.key] ?? null
    // A change against nothing is not a percentage. The card shows the pair of
    // numbers regardless, so nothing is hidden by the null.
    return { ...s, value: now, prior: was, change: pctChange(now, was) }
  })

  return {
    trainer: cur.trainer || opts.person || null,
    club: cur.club || null,
    lastSession: cur.lastSession || null,
    // A trainer with no activity still gets a card rather than an error:
    // "nothing this month" is a finding, not a failure.
    hasActivity: Boolean(current),
    comparisonLabel: (comparison && comparison.label) || null,
    comparingTo: (comparison && comparison.person) || null,
    lossBasis: LOSS_BASIS,
    stats,
    series: (series || []).map(seriesRow),
  }
}

module.exports = { buildTrainerSnapshot, seriesRow, STATS, LOSS_BASIS, rate }
