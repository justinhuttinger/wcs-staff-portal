const test = require('node:test')
const assert = require('node:assert')
const { buildTrainerPerformance, buildRow, sortRows, rate } = require('./trainerPerformance')

function row(over = {}) {
  return {
    trainer: 'Tom Anderson',
    club_number: '7655',
    last_session: '2026-07-31',
    unique_members: 44,
    completed_sessions: 171,
    cancelled_sessions: 9,
    session_minutes: 9576,
    pt_minutes: 9720,
    class_minutes: 0,
    member_months: 3.7,
    day_ones_booked: 24,
    day_ones_completed: 11,
    day_ones_sold: 8,
    close_amount: 500,
    close_amount_estimated: false,
    ...over,
  }
}

const totals = (over = {}) => ({
  unique_members: 583, trainers: 48,
  completed_sessions: 2464, cancelled_sessions: 27,
  session_minutes: 135120, pt_minutes: 134820, class_minutes: 300,
  day_ones_booked: 320, day_ones_completed: 127, day_ones_sold: 45,
  close_amount: 51781.25,
  ...over,
})

const clubs = { 7655: 'Eugene' }
const opts = { clubNameFor: n => clubs[n] || n }

test('rates divide by the right base', () => {
  const r = buildRow(row(), opts.clubNameFor)
  // Cancellations against everything that reached a conclusion, not against
  // completed alone: 9 / (171 + 9).
  assert.equal(r.cancellationRate, 5)
  // Close rate is of intros COMPLETED, not booked — a no-show was never a
  // chance to sell.
  assert.equal(r.closeRate, 72.7)
  assert.equal(r.avgSessionMinutes, 56)
  assert.equal(r.ptHours, 162)
})

test('a trainer with no intros has no close rate, not a zero one', () => {
  const r = buildRow(row({ day_ones_booked: 0, day_ones_completed: 0, day_ones_sold: 0 }), opts.clubNameFor)
  assert.equal(r.closeRate, null)
  assert.equal(rate(0, 0), null)
})

test('no sessions means no average session length', () => {
  const r = buildRow(row({ completed_sessions: 0, session_minutes: 0, cancelled_sessions: 0 }), opts.clubNameFor)
  assert.equal(r.avgSessionMinutes, null)
  assert.equal(r.cancellationRate, null)
})

test('descending sorts put unknown rates LAST, never first', () => {
  // A trainer never given an intro must not top "Best Close Rate" by virtue of
  // having no rate at all.
  const rows = [
    buildRow(row({ trainer: 'NoIntros', day_ones_completed: 0, day_ones_sold: 0 }), opts.clubNameFor),
    buildRow(row({ trainer: 'Closer', day_ones_completed: 10, day_ones_sold: 5 }), opts.clubNameFor),
  ]
  const sorted = sortRows(rows, 'close_rate_desc')
  assert.equal(sorted[0].trainer, 'Closer')
  assert.equal(sorted[sorted.length - 1].trainer, 'NoIntros')
})

test('the headline comes from SQL because unique members do not add up', () => {
  // 583 distinct members against a naive per-trainer sum of 634 — 51 members
  // train with more than one trainer. Summing the column would overstate it.
  const out = buildTrainerPerformance(
    [row({ trainer: 'A', unique_members: 300 }), row({ trainer: 'B', unique_members: 334 })],
    totals(), opts
  )
  assert.equal(out.tiles.find(t => t.key === 'uniqueMembers').value, 583)
})

test('headline rates are pooled, not averaged across trainers', () => {
  const out = buildTrainerPerformance([row()], totals(), opts)
  // 27 / (2464 + 27), not the mean of each trainer's rate — which would weight
  // a trainer with three sessions the same as one with two hundred.
  assert.equal(out.tiles.find(t => t.key === 'cancellationRate').value, 1.1)
  assert.equal(out.tiles.find(t => t.key === 'closeRate').value, 35.4)
  assert.equal(out.tiles.find(t => t.key === 'avgSessionMinutes').value, 55)
})

test('trainers who did nothing in the window are dropped', () => {
  const idle = row({
    trainer: 'Idle', completed_sessions: 0, cancelled_sessions: 0, session_minutes: 0,
    pt_minutes: 0, class_minutes: 0, day_ones_booked: 0, day_ones_completed: 0,
    day_ones_sold: 0, close_amount: 0, unique_members: 0,
  })
  const out = buildTrainerPerformance([row(), idle], totals(), opts)
  assert.deepEqual(out.rows.map(r => r.trainer), ['Tom Anderson'])
})

test('a manager who only ran intros is KEPT', () => {
  // 12 of 42 Day One trainers deliver no sessions at all — Ryan Harris has 151
  // intros and nothing else. Dropping them would delete the busiest closers.
  const manager = row({
    trainer: 'Ryan Harris', completed_sessions: 0, cancelled_sessions: 0,
    session_minutes: 0, pt_minutes: 0, class_minutes: 0, unique_members: 0,
    member_months: null, last_session: null, day_ones_booked: 151,
    day_ones_completed: 90, day_ones_sold: 30, close_amount: 12000,
  })
  const out = buildTrainerPerformance([manager], totals(), opts)
  assert.equal(out.rows.length, 1)
  const r = out.rows[0]
  assert.equal(r.trainer, 'Ryan Harris')
  assert.equal(r.closeRate, 33.3)
  // Nothing invented for the half of the report they have no data for.
  assert.equal(r.lastSession, null)
  assert.equal(r.avgSessionMinutes, null)
  assert.equal(r.memberMonths, null)
})

test('club numbers become names, and a missing club is not guessed', () => {
  assert.equal(buildRow(row(), opts.clubNameFor).club, 'Eugene')
  assert.equal(buildRow(row({ club_number: null }), opts.clubNameFor).club, null)
})

test('empty input does not throw', () => {
  assert.doesNotThrow(() => buildTrainerPerformance([], null, opts))
  assert.doesNotThrow(() => buildTrainerPerformance(null, undefined, opts))
  const out = buildTrainerPerformance(null, undefined, opts)
  assert.deepEqual(out.rows, [])
  assert.equal(out.tiles.find(t => t.key === 'cancellationRate').value, null)
})

test('an estimated close amount is flagged, not silently presented as exact', () => {
  // payroll_recurring_commissions is loaded by hand and starts 2026-04. Before
  // that the deliverer stands in for the commission employee, and the report
  // has to say so — February 2026 returns 23 such rows.
  assert.equal(buildRow(row(), opts.clubNameFor).closeAmountEstimated, false)
  assert.equal(buildRow(row({ close_amount_estimated: true }), opts.clubNameFor).closeAmountEstimated, true)
})

test('a pure closer with no sessions still ranks on money', () => {
  // Managers run the Day Ones and take the commission; trainers deliver. The
  // top of the close-amount list is mostly people with zero sessions, and the
  // sort must not bury them.
  const rows = [
    buildRow(row({ trainer: 'Deliverer', close_amount: 100, completed_sessions: 200 }), opts.clubNameFor),
    buildRow(row({ trainer: 'Closer', close_amount: 5860, completed_sessions: 0 }), opts.clubNameFor),
  ]
  assert.equal(sortRows(rows, 'close_amount_desc')[0].trainer, 'Closer')
  assert.equal(sortRows(rows, 'sessions_desc')[0].trainer, 'Deliverer')
})
