const test = require('node:test')
const assert = require('node:assert')
const { normalizeService, computeProjections } = require('./ptProjections')

function svc(memberId, trainer, location, nextBillingDate, amount) {
  return { memberId, name: 'M' + memberId, trainer, location, nextBillingDate, amount }
}

test('normalizeService maps raw ABC fields', () => {
  const n = normalizeService({
    memberId: '99', memberFirstName: 'Jo', memberLastName: 'Doe',
    serviceEmployeeFirstName: 'Pat', serviceEmployeeLastName: 'Lee',
    invoiceTotal: '120.00', recurringServiceDates: { nextBillingDate: '2026-06-28' },
  }, 'salem')
  assert.equal(n.memberId, '99')
  assert.equal(n.name, 'Jo Doe')
  assert.equal(n.trainer, 'Pat Lee')
  assert.equal(n.location, 'salem')
  assert.equal(n.nextBillingDate, '2026-06-28')
  assert.equal(n.amount, 120)
})

test('reconciliation splits collected, outstanding, past-due without double counting', () => {
  const today = '2026-06-25'
  const services = [
    svc('1', 'Pat Lee', 'salem', '2026-06-28', 100),   // outstanding (>= today, <= end)
    svc('2', 'Pat Lee', 'salem', '2026-06-10', 200),   // past-due (< today, >= start)
    svc('3', 'Sam Fox', 'eugene', '2026-07-05', 300),  // future (after window end) -> not outstanding/pastdue
  ]
  const collected = [
    { memberNumber: '4', location: 'salem', amount: 50 },   // collected, not in recurring pop
    { memberNumber: '2', location: 'salem', amount: 200 },  // collected AND member also has past-due svc
  ]
  const r = computeProjections({
    services, collected, windowStart: '2026-06-01', windowEnd: '2026-06-30', today,
  })
  assert.equal(r.summary.collected, 250)     // 50 + 200
  assert.equal(r.summary.outstanding, 100)   // svc 1
  assert.equal(r.summary.pastDue, 200)       // svc 2
  assert.equal(r.summary.projected, 550)     // 250 + 100 + 200
  assert.equal(r.summary.asOf, today)
})

test('byDay lists only upcoming drafts in [today, end], ascending', () => {
  const r = computeProjections({
    services: [
      svc('1', 'A', 'salem', '2026-06-28', 100),
      svc('2', 'A', 'salem', '2026-06-28', 50),
      svc('3', 'A', 'salem', '2026-06-10', 200), // past-due, excluded from byDay
      svc('4', 'A', 'salem', '2026-07-09', 80),  // beyond window end, excluded
    ],
    collected: [], windowStart: '2026-06-01', windowEnd: '2026-06-30', today: '2026-06-25',
  })
  assert.deepEqual(r.byDay, [{ date: '2026-06-28', amount: 150, count: 2 }])
})

test('byLocation aggregates each bucket per slug', () => {
  const r = computeProjections({
    services: [
      svc('1', 'A', 'salem', '2026-06-28', 100),
      svc('2', 'A', 'eugene', '2026-06-10', 200),
    ],
    collected: [{ memberNumber: '9', location: 'salem', amount: 75 }],
    windowStart: '2026-06-01', windowEnd: '2026-06-30', today: '2026-06-25',
  })
  const salem = r.byLocation.find(l => l.slug === 'salem')
  const eugene = r.byLocation.find(l => l.slug === 'eugene')
  assert.deepEqual(salem, { slug: 'salem', projected: 175, collected: 75, outstanding: 100, pastDue: 0 })
  assert.deepEqual(eugene, { slug: 'eugene', projected: 200, collected: 0, outstanding: 0, pastDue: 200 })
})

test('byTrainer attributes collected via member->trainer map from services', () => {
  const r = computeProjections({
    services: [ svc('1', 'Pat Lee', 'salem', '2026-06-28', 100) ],
    collected: [
      { memberNumber: '1', location: 'salem', amount: 100 }, // member 1 -> Pat Lee
      { memberNumber: '5', location: 'salem', amount: 40 },  // unknown member -> "Other"
    ],
    windowStart: '2026-06-01', windowEnd: '2026-06-30', today: '2026-06-25',
  })
  const pat = r.byTrainer.find(t => t.trainer === 'Pat Lee')
  assert.equal(pat.collected, 100)
  assert.equal(pat.projected, 200)   // collected 100 + own upcoming 100
  assert.equal(pat.count, 1)
  const other = r.byTrainer.find(t => t.trainer === 'Other')
  assert.equal(other.collected, 40)
  assert.equal(other.projected, 40)  // collected only, no services
})

test('member status classification', () => {
  const r = computeProjections({
    services: [
      svc('1', 'A', 'salem', '2026-06-28', 100),  // upcoming
      svc('2', 'A', 'salem', '2026-06-10', 200),  // pastdue (no collected row)
      svc('3', 'A', 'salem', '2026-07-09', 80),   // future
    ],
    collected: [{ memberNumber: '4', location: 'salem', amount: 50 }],
    windowStart: '2026-06-01', windowEnd: '2026-06-30', today: '2026-06-25',
  })
  const byId = Object.fromEntries(r.members.map(m => [m.memberId, m.status]))
  assert.equal(byId['1'], 'upcoming')
  assert.equal(byId['2'], 'pastdue')
  assert.equal(byId['3'], 'future')
})

test('empty input yields zero summary, no crash', () => {
  const r = computeProjections({ services: [], collected: [], windowStart: '2026-06-01', windowEnd: '2026-06-30', today: '2026-06-25' })
  assert.deepEqual(r.summary, { projected: 0, collected: 0, outstanding: 0, pastDue: 0, window: { start: '2026-06-01', end: '2026-06-30' }, asOf: '2026-06-25' })
  assert.deepEqual(r.byDay, [])
})
