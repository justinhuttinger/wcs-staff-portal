const test = require('node:test')
const assert = require('node:assert')
const { shapeLeads, buildClubSnapshot } = require('./clubSnapshot')
const { DROPPED_STATS } = require('./dailySnapshot')

const ROWS = [
  { source: 'Walk-in / Manual', leads: 79, won: 40 },
  { source: 'Website', leads: 70, won: 30 },
  { source: 'Facebook', leads: 62, won: 20 },
  { source: 'Other', leads: 19, won: 14 },
]

test('shapeLeads totals every source and splits the three named ones', () => {
  const out = shapeLeads(ROWS)
  assert.strictEqual(out.leads, 230)
  assert.strictEqual(out.leadsFacebook, 62)
  assert.strictEqual(out.leadsWebsite, 70)
  assert.strictEqual(out.leadsWalkIn, 79)
  assert.strictEqual(out.leadToSaleRate, 45.2)
})

test('shapeLeads: missing rows are no data, an empty month is zero', () => {
  assert.strictEqual(shapeLeads(null), null)
  const empty = shapeLeads([])
  assert.strictEqual(empty.leads, 0)
  assert.strictEqual(empty.leadsFacebook, 0)
  assert.strictEqual(empty.leadToSaleRate, null)
})

test('buildClubSnapshot puts leads in their own group with a prior comparison', () => {
  const win = { window: {}, summary: null, pt: null }
  const built = buildClubSnapshot(win, win, [], {
    leads: ROWS, priorLeads: [{ source: 'Facebook', leads: 100, won: 50 }],
  })
  assert.ok(built.statGroups.some(g => g.key === 'leads'))
  const leads = built.stats.find(s => s.key === 'leads')
  assert.strictEqual(leads.group, 'leads')
  assert.strictEqual(leads.value, 230)
  assert.strictEqual(leads.prior, 100)
  const rate = built.stats.find(s => s.key === 'leadToSaleRate')
  assert.strictEqual(rate.betterWhen, 'flat')
  assert.ok(rate.note)
})

test('a failed lead load shows the cards as no data, not zero', () => {
  const win = { window: {}, summary: null, pt: null }
  const built = buildClubSnapshot(win, win, [], { leads: null, priorLeads: null })
  const leads = built.stats.find(s => s.key === 'leads')
  assert.strictEqual(leads.value, null)
  assert.strictEqual(leads.pending, true)
})

test('Daily Snapshot drops the lead cards (it does not load leads)', () => {
  for (const k of ['leads', 'leadsFacebook', 'leadsWebsite', 'leadsWalkIn', 'leadToSaleRate']) {
    assert.ok(DROPPED_STATS.has(k), k)
  }
})
