// Pure shaping for Analytics > Trainer Performance. No I/O; the route fetches.
//
// TWO DIFFERENT PEOPLE CAN OWN ONE ROW, and that is deliberate:
//   the session and member columns belong to whoever DELIVERED the training,
//   the close amount belongs to whoever the COMMISSION was paid to.
// See migration 144 — for July 2026 those disagree on 40% of the money.
//
// Every rate here divides by something that can legitimately be zero — a
// trainer with no intros has no close rate, not a 0% one — so `rate()` returns
// null rather than 0 and the table prints N/A. A 0% close rate against no
// attempts would rank a trainer who was never given an intro below one who
// blew ten.

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** A rate with no denominator is unknown, not zero. */
function rate(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

function round1(v) {
  return v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10
}

const SORTS = [
  { key: 'sessions_desc', label: 'Most Sessions' },
  { key: 'members_desc', label: 'Most Members' },
  { key: 'close_amount_desc', label: 'Most Closed' },
  { key: 'close_rate_desc', label: 'Best Close Rate' },
  { key: 'day_ones_desc', label: 'Most Day Ones' },
  { key: 'name', label: 'Name' },
]

/**
 * Sorting puts nulls last in every DESCENDING order.
 *
 * A trainer with no intros has a null close rate. Left to default comparison
 * that sorts alongside real numbers and can land at the top of "Best Close
 * Rate", which is precisely backwards — they have not closed anything.
 */
function byDesc(pick) {
  return (a, b) => {
    const av = pick(a)
    const bv = pick(b)
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return bv - av
  }
}

function sortRows(rows, key) {
  const out = rows.slice()
  switch (key) {
    case 'members_desc': return out.sort(byDesc(r => r.uniqueClients))
    case 'close_amount_desc': return out.sort(byDesc(r => r.closeAmount))
    case 'close_rate_desc': return out.sort(byDesc(r => r.closeRate))
    case 'day_ones_desc': return out.sort(byDesc(r => r.dayOnesBooked))
    case 'name': return out.sort((a, b) => String(a.trainer).localeCompare(String(b.trainer)))
    default: return out.sort(byDesc(r => r.completedSessions))
  }
}

function buildRow(r, clubNameFor) {
  const completed = num(r.completed_sessions)
  const cancelled = num(r.cancelled_sessions)
  const dayOnesCompleted = num(r.day_ones_completed)

  return {
    trainer: r.trainer,
    club: r.club_number ? clubNameFor(r.club_number) : null,
    lastSession: r.last_session ? String(r.last_session).slice(0, 10) : null,
    uniqueClients: num(r.unique_members),
    completedSessions: completed,
    // Of everything scheduled that reached a conclusion. A cancellation is only
    // meaningful against the sessions that could have been cancelled.
    cancellationRate: rate(cancelled, completed + cancelled),
    avgSessionMinutes: completed ? Math.round(num(r.session_minutes) / completed) : null,
    memberMonths: r.member_months === null || r.member_months === undefined
      ? null
      : round1(r.member_months),
    ptHours: round1(num(r.pt_minutes) / 60),
    classHours: round1(num(r.class_minutes) / 60),
    dayOnesBooked: num(r.day_ones_booked),
    dayOnesCompleted,
    dayOnesSold: num(r.day_ones_sold),
    closeRate: rate(num(r.day_ones_sold), dayOnesCompleted),
    // Credited to whoever the commission is paid to, not the trainer who
    // delivers the sessions — those differ on 48 of 116 July sales.
    closeAmount: Math.round(num(r.close_amount) * 100) / 100,
    // True where payroll had no commission row for at least one of this
    // trainer's sales, so the deliverer stood in. Payroll is loaded by hand and
    // reaches back only to 2026-04.
    closeAmountEstimated: r.close_amount_estimated === true,
  }
}

/**
 * @param rows    from analytics_trainer_performance()
 * @param totals  the single row from analytics_trainer_performance_totals()
 * @param opts    { clubNameFor, sort }
 */
function buildTrainerPerformance(rows, totals, opts = {}) {
  const clubNameFor = opts.clubNameFor || (n => n)
  const built = (rows || []).map(r => buildRow(r, clubNameFor))

  // Trainers who did nothing at all in the window are dropped rather than shown
  // as a row of zeros. They are almost always staff who happen to share the
  // name space, and a screen of empty rows buries the people who worked.
  const active = built.filter(r =>
    r.completedSessions > 0 || r.dayOnesBooked > 0 || r.closeAmount !== 0
  )

  const t = totals || {}
  const totalCompleted = num(t.completed_sessions)
  const totalCancelled = num(t.cancelled_sessions)
  const totalDayOnesCompleted = num(t.day_ones_completed)

  return {
    rows: sortRows(active, opts.sort),
    sorts: SORTS,
    tiles: [
      { key: 'uniqueClients', label: 'Unique Clients Trained', format: 'int', value: num(t.unique_members) },
      { key: 'trainers', label: 'Trainers', format: 'int', value: num(t.trainers) },
      { key: 'completedSessions', label: 'Completed Sessions', format: 'int', value: totalCompleted },
      { key: 'cancellationRate', label: 'Cancellation Rate', format: 'pct',
        value: rate(totalCancelled, totalCompleted + totalCancelled) },
      { key: 'avgSessionMinutes', label: 'Avg Session Minutes', format: 'int',
        value: totalCompleted ? Math.round(num(t.session_minutes) / totalCompleted) : null },
      { key: 'ptHours', label: 'PT Hours', format: 'hours', value: round1(num(t.pt_minutes) / 60) },
      { key: 'classHours', label: 'Class Hours', format: 'hours', value: round1(num(t.class_minutes) / 60) },
      { key: 'dayOnesBooked', label: 'Day Ones Booked', format: 'int', value: num(t.day_ones_booked) },
      { key: 'dayOnesCompleted', label: 'Day Ones Completed', format: 'int', value: totalDayOnesCompleted },
      { key: 'closeRate', label: 'Close Rate', format: 'pct',
        value: rate(num(t.day_ones_sold), totalDayOnesCompleted) },
      { key: 'closeAmount', label: 'Close Amount', format: 'money', value: num(t.close_amount) },
    ],
  }
}

module.exports = { buildTrainerPerformance, buildRow, sortRows, rate, SORTS }
