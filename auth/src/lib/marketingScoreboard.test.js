const test = require('node:test')
const assert = require('node:assert/strict')
const { buildScoreboard, clubForCampaign, isPaidChannel, daysInMonth, paceFor } = require('./marketingScoreboard')

const daily = [
  { day: '2026-09-01', channel: 'meta', leads: 10, carts: 2, joins: 1 },
  { day: '2026-09-01', channel: 'organic', leads: 4, carts: 6, joins: 3 },
  { day: '2026-09-02', channel: 'meta', leads: 0, carts: 1, joins: 0 },
  { day: '2026-09-03', channel: 'meta', leads: 5, carts: 0, joins: 2 },
]
const metaByDay = new Map([
  ['2026-09-01', { spend: 250, impressions: 10000, clicks: 80 }],
  ['2026-09-02', { spend: 100, impressions: 4000, clicks: 30 }],
  ['2026-09-03', { spend: 150, impressions: 6000, clicks: 40 }],
])

test('month length and pace', () => {
  assert.equal(daysInMonth('2026-09'), 30)
  assert.equal(daysInMonth('2028-02'), 29)
  assert.equal(paceFor(141, 23, 30), 184)
  assert.equal(paceFor(5, 0, 30), 0)
})

test('rows stop at today, with day and month-to-date CPL', () => {
  const s = buildScoreboard({ month: '2026-09', today: '2026-09-03', daily, metaByDay })
  assert.equal(s.meta.rows.length, 3)
  assert.equal(s.elapsedDays, 3)
  const [d1, d2, d3] = s.meta.rows
  assert.equal(d1.cplDay, 25)
  assert.equal(d1.cplMtd, 25)
  assert.equal(d2.cplDay, null) // spend, no leads
  assert.equal(d2.cplMtd, 35) // 350 / 10
  assert.equal(d3.cplMtd, 33.33) // 500 / 15
  assert.deepEqual(s.meta.totals, { impressions: 20000, clicks: 150, leads: 15, carts: 3, joins: 3, spend: 500 })
  assert.deepEqual(s.meta.costs, { perLead: 33.33, perCart: 166.67, perJoin: 166.67 })
})

test('pace and goals, and CPL against target', () => {
  const s = buildScoreboard({
    month: '2026-09', today: '2026-09-03', daily, metaByDay,
    goals: { meta: { leads: 200, carts: 50, joins: 40, target_cpl: 30 } },
  })
  assert.deepEqual(s.meta.goals.leads, { pace: 150, goal: 200, diff: -50 })
  assert.deepEqual(s.meta.goals.joins, { pace: 30, goal: 40, diff: -10 })
  assert.deepEqual(s.meta.cplTarget, { target: 30, actual: 33.33, over: 3.33, overPct: 11 })
  assert.equal(s.organic.goals.leads.goal, null)
})

test('a past month runs to its last day and projects to itself', () => {
  const s = buildScoreboard({ month: '2026-09', today: '2026-10-15', daily, metaByDay })
  assert.equal(s.meta.rows.length, 30)
  assert.equal(s.meta.goals.leads.pace, 15)
})

test('organic rows carry sessions and lead rate when GA4 is available', () => {
  const s = buildScoreboard({ month: '2026-09', today: '2026-09-02', daily, sessionsByDay: new Map([['2026-09-01', 200]]) })
  assert.equal(s.organic.rows[0].sessions, 200)
  assert.equal(s.organic.rows[0].leadRate, 2)
  assert.equal(s.organic.rows[1].sessions, 0)
  assert.equal(s.organic.totals.sessions, 200)
  assert.equal(s.organic.rates.cartToJoin, 50)
  const noGa = buildScoreboard({ month: '2026-09', today: '2026-09-02', daily })
  assert.equal(noGa.organic.rows[0].sessions, null)
  assert.equal(noGa.organic.totals.sessions, null)
})

test('campaigns map to clubs by name', () => {
  const clubs = [
    { slug: 'salem', name: 'Salem' },
    { slug: 'milwaukie', name: 'Milwaukie', tradingName: 'East Side Athletic Club' },
  ]
  assert.equal(clubForCampaign('Salem - Cold Website Leads', clubs), 'salem')
  assert.equal(clubForCampaign('Milwaukie Lead Campaign', clubs), 'milwaukie')
  assert.equal(clubForCampaign('East Side Athletic Club Swim', clubs), 'milwaukie')
  assert.equal(clubForCampaign('Salemtown promo', clubs), null)
  assert.equal(clubForCampaign('Brand awareness', clubs), null)
})

test('paid GA4 channels are excluded from organic', () => {
  assert.equal(isPaidChannel('Paid Social'), true)
  assert.equal(isPaidChannel('Paid Search'), true)
  assert.equal(isPaidChannel('Organic Social'), false)
  assert.equal(isPaidChannel('Direct'), false)
})

test('Instant Form leads come from Meta when instantFromMeta, GHL otherwise', () => {
  // Oct 3 2026: GHL got 1 paid website lead and no Instant Form leads (its
  // Facebook integration was down); Meta reported 9 Instant Form leads.
  const rows = [
    { day: '2026-10-02', channel: 'meta', leads: 14, carts: 0, joins: 0, instant_leads: 12 },
    { day: '2026-10-03', channel: 'meta', leads: 1, carts: 0, joins: 0, instant_leads: 0 },
  ]
  const byDay = new Map([
    ['2026-10-02', { spend: 100, impressions: 0, clicks: 0, instantLeads: 13 }],
    ['2026-10-03', { spend: 100, impressions: 0, clicks: 0, instantLeads: 9 }],
  ])
  const fromMeta = buildScoreboard({ month: '2026-10', today: '2026-10-03', daily: rows, metaByDay: byDay, instantFromMeta: true })
  assert.deepEqual(fromMeta.meta.rows.map(r => r.leads), [0, 15, 10])
  assert.equal(fromMeta.meta.totals.leads, 25)
  const fromGhl = buildScoreboard({ month: '2026-10', today: '2026-10-03', daily: rows, metaByDay: byDay })
  assert.deepEqual(fromGhl.meta.rows.map(r => r.leads), [0, 14, 1])
})
