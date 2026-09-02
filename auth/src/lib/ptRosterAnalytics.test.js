const test = require('node:test')
const assert = require('node:assert')
const { buildPtRoster, buildSessionFrequency, isPaidInFull } = require('./ptRosterAnalytics')

const svc = (over = {}) => ({
  member_id: 'M1', member_name: 'Jane Doe', club_number: '30935',
  trainer_name: 'Katie Castlio', recurring_type_desc: 'Recurring Service',
  status: 'active', sub_status: 'Approved', frequency: 'Monthly',
  invoice_total: 200, sale_date: '2026-08-01',
  ...over,
})

const stat = (out, key) => out.stats.find(s => s.key === key)

// ---------------------------------------------------------------------------
// PT Roster
// ---------------------------------------------------------------------------

test('paid in full is recognised however it is written', () => {
  assert.equal(isPaidInFull({ recurring_type_desc: 'PT Paid in Full' }), true)
  assert.equal(isPaidInFull({ recurring_type_desc: 'paid IN full 12' }), true)
  assert.equal(isPaidInFull({ recurring_type_desc: 'Recurring Service' }), false)
  assert.equal(isPaidInFull(null), false)
})

// One member on two services is ONE client. Counting services would inflate the
// roster against every other client count in Analytics.
test('a member on two services is one client with both drafts', () => {
  const out = buildPtRoster([svc(), svc({ invoice_total: 100 })], [])
  assert.equal(stat(out, 'clients').value, 1)
  assert.equal(out.clients[0].services, 2)
  assert.equal(out.clients[0].monthly, 300)
})

test('different members are different clients', () => {
  const out = buildPtRoster([svc(), svc({ member_id: 'M2', member_name: 'John Roe' })], [])
  assert.equal(stat(out, 'clients').value, 2)
})

// Same member id at two clubs is two memberships, not one client — ABC member
// ids are only unique within a club.
test('the same member id at two clubs is two clients', () => {
  const out = buildPtRoster([svc(), svc({ club_number: '31599' })], [])
  assert.equal(stat(out, 'clients').value, 2)
})

test('a client on both recurring and paid in full counts as recurring', () => {
  const out = buildPtRoster(
    [svc()],
    [svc({ recurring_type_desc: 'Paid in Full', invoice_total: 1200 })]
  )
  assert.equal(stat(out, 'clients').value, 1)
  assert.equal(stat(out, 'recurring').value, 1)
  assert.equal(stat(out, 'pif').value, 0)
  assert.equal(out.clients[0].paidUpFront, 1200)
})

test('frozen clients stay on the roster and are flagged', () => {
  const out = buildPtRoster([svc({ sub_status: 'Frozen' })], [])
  assert.equal(stat(out, 'clients').value, 1)
  assert.equal(stat(out, 'frozen').value, 1)
  assert.equal(out.clients[0].frozen, true)
})

// A paid-in-full client has no monthly draft, so including them would drag the
// average toward zero for a reason that has nothing to do with pricing.
test('average draft is over recurring clients only', () => {
  const out = buildPtRoster(
    [svc({ invoice_total: 200 })],
    [svc({ member_id: 'M2', recurring_type_desc: 'Paid in Full', invoice_total: 1200 })]
  )
  assert.equal(stat(out, 'monthlyRevenue').value, 200)
  assert.equal(stat(out, 'avgDraft').value, 200)
})

test('no recurring clients leaves the average unknown, not zero', () => {
  const out = buildPtRoster([], [svc({ recurring_type_desc: 'Paid in Full' })])
  assert.equal(stat(out, 'avgDraft').value, null)
})

test('an empty roster is inactive rather than an error', () => {
  const out = buildPtRoster([], [])
  assert.equal(out.hasActivity, false)
  assert.deepEqual(out.clients, [])
})

// ---------------------------------------------------------------------------
// Session Frequency
// ---------------------------------------------------------------------------

const ev = (over = {}) => ({
  member_id: 'M1', member_first_name: 'Jane', member_last_name: 'Doe',
  club_number: '30935', employee_first_name: 'Katie', employee_last_name: 'Castlio',
  event_timestamp_local: '2026-08-10T09:00:00',
  ...over,
})

test('sessions per week divides by the window, not the count of days', () => {
  const out = buildSessionFrequency([ev(), ev(), ev(), ev()], [], {
    currentWeeks: 2, priorWeeks: 4,
  })
  assert.equal(stat(out, 'sessions').value, 4)
  assert.equal(stat(out, 'perWeek').value, 2)
})

// The two windows are rarely the same length. Comparing raw counts across a
// three-day month-to-date and a full prior month says everybody stopped.
test('the prior window is rated over its own length', () => {
  const out = buildSessionFrequency([ev()], [ev(), ev(), ev(), ev()], {
    currentWeeks: 1, priorWeeks: 4,
  })
  assert.equal(stat(out, 'perWeek').value, 1)
  assert.equal(stat(out, 'perWeek').prior, 1)
})

// The single most useful row in the report, and keying on the current window
// alone would drop it entirely.
test('somebody who trained last window and not this one still appears', () => {
  const out = buildSessionFrequency([], [ev(), ev()], { currentWeeks: 4, priorWeeks: 4 })
  assert.equal(out.rows.length, 1)
  assert.equal(out.rows[0].sessions, 0)
  assert.equal(out.rows[0].priorSessions, 2)
  assert.equal(stat(out, 'lapsed').value, 1)
  assert.equal(out.lapsed[0].member, 'Jane Doe')
})

test('somebody training in both windows is not counted as lapsed', () => {
  const out = buildSessionFrequency([ev()], [ev()], { currentWeeks: 4, priorWeeks: 4 })
  assert.equal(stat(out, 'lapsed').value, 0)
  assert.equal(out.rows[0].change, 0)
})

// A client who switched trainers should read against the one they see now.
test('the trainer shown is the most recent one', () => {
  const out = buildSessionFrequency([
    ev({ event_timestamp_local: '2026-08-01T09:00:00', employee_first_name: 'Old', employee_last_name: 'Trainer' }),
    ev({ event_timestamp_local: '2026-08-20T09:00:00', employee_first_name: 'New', employee_last_name: 'Trainer' }),
  ], [], { currentWeeks: 4, priorWeeks: 4 })
  assert.equal(out.rows[0].trainer, 'New Trainer')
})

test('sessions with no member id are ignored rather than pooled into one client', () => {
  const out = buildSessionFrequency([ev({ member_id: null }), ev()], [], {
    currentWeeks: 4, priorWeeks: 4,
  })
  assert.equal(out.rows.length, 1)
  assert.equal(out.rows[0].sessions, 1)
})

test('the frequency buckets cover every client exactly once', () => {
  const out = buildSessionFrequency(
    [ev(), ev(), ev(), ev(), ev({ member_id: 'M2' })],
    [ev({ member_id: 'M3' })],
    { currentWeeks: 1, priorWeeks: 1 }
  )
  const total = out.breakdowns.byFrequency.reduce((n, b) => n + b.count, 0)
  assert.equal(total, out.rows.length)
})

test('no sessions either window is inactive rather than an error', () => {
  const out = buildSessionFrequency([], [], { currentWeeks: 4, priorWeeks: 4 })
  assert.equal(out.hasActivity, false)
  assert.equal(stat(out, 'clients').value, 0)
})

// ---------------------------------------------------------------------------
// Grouping the roster by trainer.
// ---------------------------------------------------------------------------

const { groupByTrainer } = require('./ptRosterAnalytics')

const client = (over = {}) => ({
  member: 'Jane Doe', trainer: 'Katie Castlio', type: 'recurring',
  monthly: 200, paidUpFront: 0, frozen: false, ...over,
})

test('clients group under the trainer who has them', () => {
  const out = groupByTrainer([
    client(),
    client({ member: 'John Roe' }),
    client({ member: 'Sam Ray', trainer: 'Tom Anderson' }),
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].trainer, 'Katie Castlio')
  assert.equal(out[0].count, 2)
  assert.equal(out[0].monthly, 400)
})

test('the busiest trainer leads, ties broken by name', () => {
  const out = groupByTrainer([
    client({ trainer: 'Zoe Last' }),
    client({ trainer: 'Amy First' }),
    client({ trainer: 'Busy One' }),
    client({ trainer: 'Busy One', member: 'Second' }),
  ])
  assert.deepEqual(out.map(t => t.trainer), ['Busy One', 'Amy First', 'Zoe Last'])
})

// A client with no trainer is a gap somebody should close. Dropping them would
// make the roster add up to less than it is; leading with them would put a
// non-trainer at the top of a list of trainers.
test('Unassigned is kept and sorted last however big it is', () => {
  const out = groupByTrainer([
    client({ trainer: 'Unassigned' }),
    client({ trainer: 'Unassigned', member: 'B' }),
    client({ trainer: 'Unassigned', member: 'C' }),
    client({ trainer: 'Katie Castlio' }),
  ])
  assert.equal(out[out.length - 1].trainer, 'Unassigned')
  assert.equal(out[out.length - 1].count, 3)
  assert.equal(out.reduce((n, t) => n + t.count, 0), 4)
})

test('frozen clients are counted on the trainer line', () => {
  const out = groupByTrainer([client({ frozen: true }), client({ member: 'B' })])
  assert.equal(out[0].frozen, 1)
  assert.equal(out[0].count, 2)
})

test('no clients groups to nothing rather than throwing', () => {
  assert.deepEqual(groupByTrainer([]), [])
  assert.deepEqual(groupByTrainer(null), [])
})

// ---------------------------------------------------------------------------
// Trainer bands on Session Frequency.
// ---------------------------------------------------------------------------

const { withTrainerBands } = require('./ptRosterAnalytics')

const row = (trainer, member) => ({ trainer, member })

// One block per trainer, not one per row. Striping every row says nothing the
// rows do not already say by being rows.
test('every row of a trainer shares a band, and the next trainer flips it', () => {
  const out = withTrainerBands([
    row('Amy', 'a'), row('Amy', 'b'), row('Amy', 'c'),
    row('Bob', 'd'), row('Bob', 'e'),
    row('Cat', 'f'),
  ])
  assert.deepEqual(out.map(r => r.band), [0, 0, 0, 1, 1, 0])
})

test('one trainer is one band', () => {
  const out = withTrainerBands([row('Amy', 'a'), row('Amy', 'b')])
  assert.deepEqual(out.map(r => r.band), [0, 0])
})

test('a trainer per row alternates every row, which is the degenerate case', () => {
  const out = withTrainerBands([row('A', 'a'), row('B', 'b'), row('C', 'c')])
  assert.deepEqual(out.map(r => r.band), [0, 1, 0])
})

test('banding leaves the rows themselves untouched', () => {
  const out = withTrainerBands([row('Amy', 'a')])
  assert.equal(out[0].trainer, 'Amy')
  assert.equal(out[0].member, 'a')
})

test('no rows band to nothing rather than throwing', () => {
  assert.deepEqual(withTrainerBands([]), [])
  assert.deepEqual(withTrainerBands(null), [])
})

// The rows the report actually produces must already be trainer-ordered, or a
// band is a run of one and the shading is noise again.
test('session frequency rows come out grouped by trainer', () => {
  const e = (t, m, d) => ({
    member_id: m, member_first_name: m, member_last_name: 'X', club_number: '30935',
    employee_first_name: t, employee_last_name: 'T', event_timestamp_local: d,
  })
  const out = buildSessionFrequency([
    e('Zoe', 'm1', '2026-08-01T09:00:00'),
    e('Amy', 'm2', '2026-08-02T09:00:00'),
    e('Zoe', 'm3', '2026-08-03T09:00:00'),
  ], [], { currentWeeks: 4, priorWeeks: 4 })
  const trainers = out.rows.map(r => r.trainer)
  assert.deepEqual(trainers, [...trainers].sort())
  // Two trainers, so two bands.
  assert.equal(new Set(out.rows.map(r => r.band)).size, 2)
})

// ---------------------------------------------------------------------------
// The roster's month-ago comparison.
// ---------------------------------------------------------------------------

test('each card carries where it was and how far it moved', () => {
  const prior = buildPtRoster([svc()], [])
  const out = buildPtRoster([svc(), svc({ member_id: 'M2' })], [], { prior })
  const clients = out.stats.find(s => s.key === 'clients')
  assert.equal(clients.value, 2)
  assert.equal(clients.prior, 1)
  assert.equal(clients.change, 100)
})

// Nothing to compare against is unknown, not "no change" — a dash and a 0%
// are different claims.
test('no prior roster leaves the comparison unknown, not zero', () => {
  const out = buildPtRoster([svc()], [])
  const clients = out.stats.find(s => s.key === 'clients')
  assert.equal(clients.prior, null)
  assert.equal(clients.change, null)
})

// Growth from nothing is not a percentage. The pair of numbers still shows.
test('growing from zero shows the numbers but no percentage', () => {
  const prior = buildPtRoster([], [])
  const out = buildPtRoster([svc()], [], { prior })
  const clients = out.stats.find(s => s.key === 'clients')
  assert.equal(clients.value, 1)
  assert.equal(clients.prior, 0)
  assert.equal(clients.change, null)
})

test('a shrinking figure reports a negative move', () => {
  const prior = buildPtRoster([svc(), svc({ member_id: 'M2' })], [])
  const out = buildPtRoster([svc()], [], { prior })
  assert.equal(out.stats.find(s => s.key === 'clients').change, -50)
})
