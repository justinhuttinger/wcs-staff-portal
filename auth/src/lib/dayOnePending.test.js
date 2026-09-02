const test = require('node:test')
const assert = require('node:assert')
const { summarisePending, pendingForTrainer, pendingList } = require('./dayOnePending')
const { buildTrainerPerformance } = require('./trainerPerformance')

const row = (over = {}) => ({
  id: 'a', location_slug: 'salem', club_number: '30935',
  scheduled_date: '2026-08-10', days_overdue: 5,
  contact_name: 'Jane Doe', trainer_name: 'Katie Castlio',
  booked_by_name: 'Sam Front', booked_at: '2026-08-01T00:00:00Z',
  ...over,
})

test('buckets by club, day, trainer and booker from one list of rows', () => {
  const out = summarisePending([
    row(),
    row({ id: 'b', club_number: '31599', location_slug: 'keizer', scheduled_date: '2026-08-11' }),
    row({ id: 'c', trainer_name: 'Katie Castlio', days_overdue: 31 }),
  ])
  assert.equal(out.total, 3)
  assert.deepEqual(out.byClub, { 30935: 2, 31599: 1 })
  assert.deepEqual(out.byDay, { '2026-08-10': 2, '2026-08-11': 1 })
  assert.equal(out.byTrainer[0].count, 3)
  assert.equal(out.byBooker[0].count, 3)
})

test('oldestDays is the longest wait, not the newest row', () => {
  const out = summarisePending([row({ days_overdue: 3 }), row({ id: 'b', days_overdue: 44 })])
  assert.equal(out.oldestDays, 44)
  assert.equal(out.byTrainer[0].oldestDays, 44)
})

// The whole point of the metric is who to chase, so a row with no trainer must
// be visible as unassigned rather than silently dropped or filed under "".
test('a Day One with no trainer lands in Unassigned, not an empty-string bucket', () => {
  const out = summarisePending([row({ trainer_name: null }), row({ id: 'b', trainer_name: '  ' })])
  assert.equal(out.byTrainer.length, 1)
  assert.equal(out.byTrainer[0].name, 'Unassigned')
  assert.equal(out.byTrainer[0].count, 2)
})

test('trainer names differing only in inner whitespace are one person', () => {
  const out = summarisePending([row(), row({ id: 'b', trainer_name: 'Katie  Castlio' })])
  assert.equal(out.byTrainer.length, 1)
  assert.equal(out.byTrainer[0].count, 2)
  assert.equal(pendingForTrainer([row()], 'katie   castlio').length, 1)
})

test('the chase list is oldest first and capped', () => {
  const rows = [row({ id: 'a', days_overdue: 2 }), row({ id: 'b', days_overdue: 40 })]
  const list = pendingList(rows, 1)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'b')
  assert.equal(list[0].daysOverdue, 40)
})

test('an empty window summarises to zero rather than throwing', () => {
  const out = summarisePending([])
  assert.equal(out.total, 0)
  assert.equal(out.oldestDays, 0)
  assert.deepEqual(out.byTrainer, [])
})

// ---------------------------------------------------------------------------
// The merge into Trainer Performance.
// ---------------------------------------------------------------------------

const perfRow = (over = {}) => ({
  trainer: 'Katie Castlio', club_number: '30935',
  completed_sessions: 10, cancelled_sessions: 1, unique_members: 8,
  session_minutes: 600, pt_minutes: 600, class_minutes: 0,
  day_ones_booked: 4, day_ones_completed: 3, day_ones_sold: 1,
  close_amount: 1000,
  ...over,
})

test('pending merges onto the matching trainer row', () => {
  const out = buildTrainerPerformance([perfRow()], null, {
    pending: summarisePending([row(), row({ id: 'b' })]),
  })
  const r = out.rows.find(x => x.trainer === 'Katie Castlio')
  assert.equal(r.dayOnesPending, 2)
})

// analytics_trainer_performance keys its Day Ones on the BOOKING date, so a
// trainer whose only mark on the window is an intro that was booked earlier and
// never closed out returns no row at all. They are exactly who this is for.
test('a trainer present only in pending still gets a row', () => {
  const out = buildTrainerPerformance([], null, {
    pending: summarisePending([row({ trainer_name: 'Ghost Trainer' })]),
  })
  const r = out.rows.find(x => x.trainer === 'Ghost Trainer')
  assert.ok(r, 'expected a synthesised row for the pending-only trainer')
  assert.equal(r.dayOnesPending, 1)
  assert.equal(r.completedSessions, 0)
})

test('Unassigned is never synthesised as a trainer row', () => {
  const out = buildTrainerPerformance([], null, {
    pending: summarisePending([row({ trainer_name: null })]),
  })
  assert.equal(out.rows.length, 0)
})

test('a trainer with nothing outstanding reads as zero, not unknown', () => {
  const out = buildTrainerPerformance([perfRow()], null, { pending: summarisePending([]) })
  assert.equal(out.rows[0].dayOnesPending, 0)
})

// A false zero on the headline tile would say "every intro has been closed out",
// which is a much stronger claim than "nobody asked".
test('the Pending Outcome tile is null when no pending data was supplied', () => {
  const out = buildTrainerPerformance([perfRow()], null, {})
  const tile = out.tiles.find(t => t.key === 'dayOnesPending')
  assert.equal(tile.value, null)
  assert.equal(out.pending, null)
})
