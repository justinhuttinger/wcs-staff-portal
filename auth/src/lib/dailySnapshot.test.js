const test = require('node:test')
const assert = require('node:assert')
const { buildDailySnapshot, DROPPED_STATS, STOCK_STATS } = require('./dailySnapshot')

const win = (over = {}) => ({
  total_members: 9000, new_members: 13, lost_members: 14,
  new_dues: 400, revenue: 20000, pt_revenue: 3000, checkins: 2500,
  has_checkin_data: true, ...over,
})
const pt = (over = {}) => ({
  day_ones: 13, day_ones_completed: 10, day_ones_sold: 2, day_ones_no_show: 2,
  day_ones_cancelled: 1, day_ones_scheduled: 13, new_sales: 3, new_clients: 2,
  new_value: 5000, lost_value: 1000, lost_count: 1, ...over,
})
const summary = (over = {}) => ({
  pctOnAch: 80, avgNewDuesDraft: 40, vipCount: 3, vipPct: 25,
  toursGiven: 6, tourConversionRate: 33, avgDaysToConversion: 2.5, ...over,
})

const day = (over = {}) => ({ window: win(), summary: summary(), pt: pt(), ...over })

test('the card reuses Club Snapshot stats, so a day rolls up into the month', () => {
  const out = buildDailySnapshot(day(), null, [], { day: '2026-08-28' })
  const byKey = Object.fromEntries(out.stats.map(s => [s.key, s]))
  assert.equal(byKey.newMembers.value, 13)
  assert.equal(byKey.lostMembers.value, 14)
  assert.equal(byKey.netMembers.value, -1)
  assert.equal(byKey.dayOnes.value, 13)
})

test('average days tour-to-sale is dropped', () => {
  // On one day it is a gap between dates in different weeks — empty, or an
  // artefact of whoever happened to close that morning.
  const out = buildDailySnapshot(day(), null, [], {})
  assert.ok(DROPPED_STATS.has('avgDaysToConversion'))
  assert.equal(out.stats.find(s => s.key === 'avgDaysToConversion'), undefined)
})

test('the comparison is a plain difference, never a percentage', () => {
  // On a single day a base of 1 turns one extra sale into +100%, which reads as
  // a story and is not one.
  const out = buildDailySnapshot(
    day(),
    day({ window: win({ new_members: 10 }) }),
    [], {}
  )
  const joined = out.stats.find(s => s.key === 'newMembers')
  assert.equal(joined.value, 13)
  assert.equal(joined.prior, 10)
  assert.equal(joined.delta, 3)
})

test('a stock measure gets no day-over-day delta', () => {
  // Total members is a count at close of play; its change is already Net
  // Members, and showing both invites double-reading.
  const out = buildDailySnapshot(
    day(),
    day({ window: win({ total_members: 8990 }) }),
    [], {}
  )
  const members = out.stats.find(s => s.key === 'totalMembers')
  assert.ok(STOCK_STATS.has('totalMembers'))
  assert.equal(members.value, 9000)
  assert.equal(members.delta, null)
})

test('with no prior day there are values but no deltas', () => {
  const out = buildDailySnapshot(day(), null, [], {})
  assert.equal(out.yesterday, null)
  assert.ok(out.stats.every(s => s.delta === null))
  // The values themselves are still reported.
  assert.equal(out.stats.find(s => s.key === 'newMembers').value, 13)
})

// --- revenue arrives late ---------------------------------------------------

test('a day past the revenue import is flagged, not silently zeroed', () => {
  // Without this the report tells whoever opens it each morning that the club
  // took nothing yesterday.
  const out = buildDailySnapshot(day(), null, [], {
    day: '2026-08-29', latestRevenueDay: '2026-08-27',
  })
  assert.equal(out.revenueStale, true)
  assert.match(out.notes.revenue, /2026-08-27/)
  assert.match(out.notes.revenue, /Everything else on this card is live/)
})

test('a day covered by the import raises no revenue warning', () => {
  const out = buildDailySnapshot(day(), null, [], {
    day: '2026-08-26', latestRevenueDay: '2026-08-27',
  })
  assert.equal(out.revenueStale, false)
  assert.equal(out.notes.revenue, null)
})

test('the day exactly at the import edge is treated as complete', () => {
  const out = buildDailySnapshot(day(), null, [], {
    day: '2026-08-27', latestRevenueDay: '2026-08-27',
  })
  assert.equal(out.revenueStale, false)
})

test('an unknown import date makes no claim either way', () => {
  const out = buildDailySnapshot(day(), null, [], { day: '2026-08-29' })
  assert.equal(out.revenueStale, false)
  assert.equal(out.notes.revenue, null)
})

// --- the series -------------------------------------------------------------

test('the series is shaped day by day and keeps its order', () => {
  const out = buildDailySnapshot(day(), null, [
    { day: '2026-08-27', new_members: 30, lost_members: 19, net_members: 11,
      revenue: 54570, day_ones: 12, day_ones_sold: 2, pt_new_sales: 0 },
    { day: '2026-08-28', new_members: 13, lost_members: 14, net_members: -1,
      revenue: 0, day_ones: 13, day_ones_sold: 2, pt_new_sales: 0 },
  ], {})

  assert.deepEqual(out.days.map(d => d.day), ['2026-08-27', '2026-08-28'])
  assert.equal(out.days[0].netMembers, 11)
  assert.equal(out.days[1].netMembers, -1)
})

test('missing series numbers become zero, not NaN', () => {
  const out = buildDailySnapshot(day(), null, [{ day: '2026-08-28' }], {})
  assert.equal(out.days[0].newMembers, 0)
  assert.equal(out.days[0].revenue, 0)
  assert.ok(Number.isFinite(out.days[0].ptNewValue))
})

// --- a revenue stat on an un-imported day is unknown, not zero --------------

test('revenue stats read as unavailable, never as a confident zero', () => {
  // $0 tells whoever opens this each morning that the club took nothing, which
  // is a different and much worse claim than "not in yet".
  const out = buildDailySnapshot(
    day({ window: win({ revenue: 0, pt_revenue: 0 }) }),
    day(),
    [], { day: '2026-08-29', latestRevenueDay: '2026-08-27' }
  )
  const byKey = Object.fromEntries(out.stats.map(s => [s.key, s]))

  assert.equal(byKey.revenue.unavailable, true)
  assert.equal(byKey.revenue.value, null)
  assert.equal(byKey.ptRevenue.unavailable, true)
  assert.equal(byKey.ptRevenue.value, null)
})

test('an unavailable stat gets no delta against yesterday', () => {
  // Subtracting a real number from an unknown is not a movement.
  const out = buildDailySnapshot(
    day({ window: win({ revenue: 0 }) }),
    day({ window: win({ revenue: 54570 }) }),
    [], { day: '2026-08-29', latestRevenueDay: '2026-08-27' }
  )
  assert.equal(out.stats.find(s => s.key === 'revenue').delta, null)
})

test('NEW DUES stays real on an un-imported day', () => {
  // It comes from the member records, which are live — greying it out would
  // hide a number that is perfectly good.
  const out = buildDailySnapshot(day(), null, [], {
    day: '2026-08-29', latestRevenueDay: '2026-08-27',
  })
  const dues = out.stats.find(s => s.key === 'newDues')
  assert.equal(dues.unavailable, false)
  assert.equal(dues.value, 400)
})

test('everything non-revenue stays live and comparable', () => {
  const out = buildDailySnapshot(
    day(),
    day({ window: win({ new_members: 10 }) }),
    [], { day: '2026-08-29', latestRevenueDay: '2026-08-27' }
  )
  const joined = out.stats.find(s => s.key === 'newMembers')
  assert.equal(joined.unavailable, false)
  assert.equal(joined.delta, 3)
})

test('on a day inside the import nothing is greyed', () => {
  const out = buildDailySnapshot(day(), null, [], {
    day: '2026-08-26', latestRevenueDay: '2026-08-27',
  })
  assert.ok(out.stats.every(s => !s.unavailable))
  assert.equal(out.stats.find(s => s.key === 'revenue').value, 20000)
})
