const test = require('node:test')
const assert = require('node:assert')
const { buildTopline, pctChange, ratio, pctOf, checkins } = require('./toplineMetrics')

function win(over = {}) {
  return {
    new_members: 100, lost_members: 40, new_dues: 5000,
    revenue: 700000, pt_revenue: 130000, checkins: 60000,
    has_checkin_data: true, start: '2026-08-01', end: '2026-08-25',
    ...over,
  }
}

function payload(over = {}) {
  return {
    as_of: '2026-08-25',
    members: { now: 19638, prior_year: 16893, start_of_year: 17630, start_of_py: 14229, prior3mo_end: 19263 },
    windows: {
      mtd: win(), prior_mtd: win(), py_mtd: win(),
      ytd: win(), py_ytd: win(),
      last30: win(), py_last30: win(),
      past3mo: win(), prior3mo: win(), py_past3mo: win(),
    },
    ...over,
  }
}

const card = (p, key) => buildTopline(p).cards.find(c => c.key === key)
const rowOf = (c, label) => c.rows.find(r => r.label === label)

test('pctChange guards zero and missing bases', () => {
  assert.equal(pctChange(120, 100), 20)
  assert.equal(pctChange(80, 100), -20)
  assert.equal(pctChange(100, 0), null)
  assert.equal(pctChange(null, 100), null)
})

test('ratio and pctOf guard a zero denominator', () => {
  assert.equal(ratio(10, 4), 2.5)
  assert.equal(ratio(10, 0), null)
  assert.equal(pctOf(25, 100), 25)
  assert.equal(pctOf(4385, 18917), 23.2)
})

test('a check-in window predating collection reads N/A, not zero', () => {
  // A zero would say "nobody came in" rather than "we weren't collecting".
  assert.equal(checkins({ checkins: 0, has_checkin_data: false }), null)
  assert.equal(checkins({ checkins: 500, has_checkin_data: true }), 500)
  assert.equal(checkins(null), null)
})

test('the eight cards are built', () => {
  const { cards, asOf } = buildTopline(payload())
  assert.equal(cards.length, 8)
  assert.equal(asOf, '2026-08-25')
})

test('revenue MTD compares against both prior year and prior month', () => {
  const p = payload()
  p.windows.mtd = win({ revenue: 739952 })
  p.windows.py_mtd = win({ revenue: 579181 })
  p.windows.prior_mtd = win({ revenue: 733402 })
  const c = card(p, 'revenueMtd')
  assert.equal(c.value, 739952)
  assert.equal(rowOf(c, 'Prior Year MTD').value, 579181)
  assert.equal(rowOf(c, 'Prior MTD').value, 733402)
  assert.equal(rowOf(c, 'YOY Change').value, 27.8)
  assert.equal(rowOf(c, '% Change from Prior MTD').value, 0.9)
})

test('net member gain is new minus lost, and can be negative', () => {
  const p = payload()
  p.windows.ytd = win({ new_members: 6130, lost_members: 4122, new_dues: 312000 })
  const c = card(p, 'netMemberYtd')
  assert.equal(c.value, 2008)
  assert.equal(c.signed, true)
  assert.equal(rowOf(c, 'New Member Units YTD').value, 6130)
  assert.equal(rowOf(c, 'Lost Members YTD').value, 4122)
  assert.equal(rowOf(c, 'Net Dues YTD').value, 312000)

  p.windows.ytd = win({ new_members: 100, lost_members: 250 })
  assert.equal(card(p, 'netMemberYtd').value, -150)
})

test('attrition is losses over the headcount they came out of', () => {
  const p = payload()
  p.windows.ytd = win({ lost_members: 4385 })
  p.windows.py_ytd = win({ lost_members: 3011 })
  p.members = { ...p.members, now: 18917, prior_year: 16699 }
  const c = card(p, 'attritionYtd')
  assert.equal(c.value, 23.2)
  assert.equal(rowOf(c, 'Attrition Rate Prior YTD').value, 18.0)
  assert.equal(rowOf(c, 'Lost Members YOY Change').value, 45.6)
})

test('total members reads the point-in-time headcount, never a sum', () => {
  const c = card(payload(), 'totalMembers')
  assert.equal(c.value, 19638)
  assert.equal(rowOf(c, 'Prior Year').value, 16893)
  assert.equal(rowOf(c, 'YOY Change').value, 16.2)
})

test('revenue per member divides each window by its own headcount', () => {
  const p = payload()
  p.windows.past3mo = win({ revenue: 2000000 })
  p.windows.py_past3mo = win({ revenue: 1500000 })
  p.windows.prior3mo = win({ revenue: 1800000 })
  p.members = { ...p.members, now: 20000, prior_year: 15000, prior3mo_end: 18000 }
  const c = card(p, 'revenuePerMember')
  assert.equal(c.value, 100)
  // Prior year uses the prior-year headcount, not today's.
  assert.equal(rowOf(c, 'Past 3 Months Prior Year').value, 100)
  // The prior 3 months uses the headcount at the END of that window.
  assert.equal(rowOf(c, 'Prior 3 Months').value, 100)
  assert.equal(rowOf(c, 'YOY Change').value, 0)
})

test('the check-in card carries its own health warning', () => {
  const c = card(payload(), 'checkinsLast30')
  // The hourly feed is structurally short, so this card must not present its
  // year-over-year as trustworthy.
  assert.ok(c.suspect)
  assert.match(c.suspect, /undercounted/i)
})

test('a check-in window with no data leaves the card N/A rather than 0', () => {
  const p = payload()
  p.windows.py_last30 = win({ checkins: 0, has_checkin_data: false })
  const c = card(p, 'checkinsLast30')
  assert.equal(rowOf(c, 'Last 30 Days Prior Year').value, null)
  assert.equal(rowOf(c, 'YOY Change').value, null)
})

test('a missing payload does not throw', () => {
  const { cards, asOf } = buildTopline(null)
  assert.equal(cards.length, 8)
  assert.equal(asOf, null)
  assert.equal(cards[0].value, null)
})
