const test = require('node:test')
const assert = require('node:assert')

const { monthToDate, priorMonthWindow, pctChange, daysInMonth } = require('./snapshotWindow')
const { buildTrainerSnapshot, seriesRow: trainerSeriesRow } = require('./trainerSnapshot')
const { buildMembershipSnapshot, seriesRow: memberSeriesRow } = require('./membershipSnapshot')

// ---------------------------------------------------------------------------
// snapshotWindow
// ---------------------------------------------------------------------------

test('the prior window is the same span one month earlier', () => {
  assert.deepEqual(priorMonthWindow('2026-08-01', '2026-08-28'), { start: '2026-07-01', end: '2026-07-28' })
})

test('the day of month is clamped, never rolled over', () => {
  // 31 March back a month is 28 February. Rolling over to 3 March would compare
  // 31 days against 3 and report a collapse that never happened.
  assert.deepEqual(priorMonthWindow('2026-03-01', '2026-03-31'), { start: '2026-02-01', end: '2026-02-28' })
  // And a leap year is respected rather than hard-coded.
  assert.equal(daysInMonth(2024, 2), 29)
  assert.deepEqual(priorMonthWindow('2024-03-31', '2024-03-31').end, '2024-02-29')
})

test('the prior window crosses the year boundary', () => {
  assert.deepEqual(priorMonthWindow('2026-01-01', '2026-01-15'), { start: '2025-12-01', end: '2025-12-15' })
})

test('month to date starts on the first', () => {
  const w = monthToDate(new Date(Date.UTC(2026, 7, 28)))
  assert.deepEqual(w, { start: '2026-08-01', end: '2026-08-28' })
})

test('a change from nothing is not a percentage', () => {
  // Zero to five is not "infinite percent"; the card shows both numbers anyway.
  assert.equal(pctChange(5, 0), null)
  assert.equal(pctChange(120, 100), 20)
  assert.equal(pctChange(80, 100), -20)
  assert.equal(pctChange(null, 100), null)
})

// ---------------------------------------------------------------------------
// Trainer Snapshot
// ---------------------------------------------------------------------------

const trainerRow = (over = {}) => ({
  trainer: 'Tom Anderson', club: 'Eugene', lastSession: '2026-08-27',
  completedSessions: 126, uniqueClients: 31, ptHours: 117.5,
  avgSessionMinutes: 56, cancellationRate: 2.1, memberMonths: 3.7,
  dayOnesBooked: 9, dayOnesCompleted: 5, dayOnesSold: 1,
  closeRate: 20, closeAmount: 1575, ...over,
})

test('each trainer stat carries its prior value and the change', () => {
  const out = buildTrainerSnapshot(trainerRow(), trainerRow({ completedSessions: 171, closeAmount: 3850 }), [])
  const sessions = out.stats.find(s => s.key === 'completedSessions')
  assert.equal(sessions.value, 126)
  assert.equal(sessions.prior, 171)
  assert.equal(sessions.change, -26.3)
  const close = out.stats.find(s => s.key === 'closeAmount')
  assert.equal(close.change, -59.1)
})

test('direction of good is declared, not assumed', () => {
  const out = buildTrainerSnapshot(trainerRow(), null, [])
  // A rising cancellation rate is bad while a rising close rate is good, and
  // colour is the only thing carrying that on the card.
  assert.equal(out.stats.find(s => s.key === 'cancellationRate').betterWhen, 'down')
  assert.equal(out.stats.find(s => s.key === 'closeRate').betterWhen, 'up')
})

test('a trainer with no activity gets a card, not an error', () => {
  const out = buildTrainerSnapshot(null, null, [], { person: 'Nobody Home' })
  assert.equal(out.hasActivity, false)
  assert.equal(out.trainer, 'Nobody Home')
  assert.equal(out.stats.every(s => s.value === null), true)
})

test('trainer series derives rates rather than trusting raw counts', () => {
  const r = trainerSeriesRow({
    month_start: '2026-07-01', completed_sessions: 171, cancelled_sessions: 9,
    unique_clients: 44, pt_minutes: 9720, day_ones_booked: 24,
    day_ones_completed: 11, day_ones_sold: 8, close_amount: 3850,
  })
  assert.equal(r.ptHours, 162)
  assert.equal(r.cancellationRate, 5)      // 9 / (171 + 9)
  assert.equal(r.closeRate, 72.7)          // 8 / 11, of COMPLETED intros
})

test('a month with no intros has no close rate', () => {
  const r = trainerSeriesRow({ month_start: '2026-07-01', day_ones_completed: 0, day_ones_sold: 0 })
  assert.equal(r.closeRate, null)
  assert.equal(r.cancellationRate, null)
})

// ---------------------------------------------------------------------------
// Membership Snapshot
// ---------------------------------------------------------------------------

const memberRow = (over = {}) => ({
  salesperson: 'Katie Castlio', club: 'East Side Athletic Club',
  newMemberUnits: 35, pctOfClubTotal: 42.1,
  dayOneBookCount: 12, dayOneBookPct: 34.3,
  bookOnJoinDateCount: 7, bookOnJoinDatePct: 20,
  achCount: 30, achPct: 85.7,
  avgNextDueAmount: 62.5, avgDownPayment: 0, ...over,
})

test('each membership stat carries its prior value and the change', () => {
  const out = buildMembershipSnapshot(memberRow(), memberRow({ newMemberUnits: 65 }), [])
  const units = out.stats.find(s => s.key === 'newMemberUnits')
  assert.equal(units.value, 35)
  assert.equal(units.prior, 65)
  assert.equal(units.change, -46.2)
})

test('membership series computes book % against the members signed', () => {
  const r = memberSeriesRow({
    month_start: '2026-08-01', new_members: 35, day_ones_booked: 12,
    day_ones_completed: 5, day_ones_sold: 1,
  })
  assert.equal(r.bookPct, 34.3)
  assert.equal(r.closeRate, 20)
})

test('a month with no members signed has no book rate', () => {
  // Not 0% — nobody was signed, so there was nothing to book for.
  const r = memberSeriesRow({ month_start: '2026-08-01', new_members: 0, day_ones_booked: 0 })
  assert.equal(r.bookPct, null)
})

test('snapshot builders survive empty input', () => {
  assert.doesNotThrow(() => buildTrainerSnapshot(null, null, null))
  assert.doesNotThrow(() => buildMembershipSnapshot(null, null, null))
  assert.deepEqual(buildMembershipSnapshot(null, null, null).series, [])
})
