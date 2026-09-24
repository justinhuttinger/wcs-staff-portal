const { test } = require('node:test')
const assert = require('node:assert')
const { buildFacebookBreakdown, buildWebTraffic, LOW_TRAFFIC_NOTE } = require('./leadSourceBreakdowns')

const row = (campaign, adset, ad, leads, won, extra = {}) =>
  ({ campaign, adset, ad, ad_id: extra.ad_id || null, leads, tours: 0, trials: extra.trials || 0, won, lost: 0 })

test('rows nest campaign > ad set > ad and roll up at every level', () => {
  const tree = buildFacebookBreakdown([
    row('Medford Lead Campaign', 'Feb set', 'Renderings', 4, 3, { trials: 4, ad_id: '6940551519501' }),
    row('Medford Lead Campaign', 'Feb set', 'Alex', 6, 6, { trials: 6 }),
    row('Medford Lead Campaign', 'July set', 'Carousel', 14, 0),
    row('Milwaukie Lead Campaign', 'July set', 'Lead Ad', 48, 0),
  ])
  assert.deepStrictEqual(tree.map(c => [c.name, c.leads, c.won]),
    [['Milwaukie Lead Campaign', 48, 0], ['Medford Lead Campaign', 24, 9]])
  const medford = tree[1]
  assert.deepStrictEqual(medford.adsets.map(s => [s.name, s.leads]), [['July set', 14], ['Feb set', 10]])
  const feb = medford.adsets[1]
  assert.deepStrictEqual(feb.ads.map(a => a.name), ['Alex', 'Renderings'])
  assert.strictEqual(feb.ads[1].adId, '6940551519501')
  assert.strictEqual(feb.winRate, 90)
  assert.strictEqual(feb.trialRate, 100)
})

test('the same ad set name under two campaigns stays two ad sets', () => {
  const tree = buildFacebookBreakdown([
    row('A', 'On Platform Campaign', 'Best Place', 5, 0),
    row('B', 'On Platform Campaign', 'Best Place', 3, 0),
  ])
  assert.deepStrictEqual(tree.map(c => c.adsets[0].leads), [5, 3])
})

test('no rows is an empty list, not an error', () => {
  assert.deepStrictEqual(buildFacebookBreakdown([]), [])
  assert.deepStrictEqual(buildFacebookBreakdown(null), [])
})

test('web traffic gives each channel its share of visits', () => {
  const web = buildWebTraffic([
    { channel: 'Paid Social', sessions: 3000, keyEvents: 40 },
    { channel: 'Direct', sessions: 1000, keyEvents: 5 },
    { channel: 'Unassigned', sessions: 0, keyEvents: 0 },
  ])
  assert.deepStrictEqual(web.channels.map(c => [c.channel, c.share]), [['Paid Social', 75], ['Direct', 25]])
  assert.deepStrictEqual(web.totals, { sessions: 4000, keyEvents: 45 })
  assert.strictEqual(web.warning, null)
})

test('a near-empty GA4 property is called out rather than shown as a quiet month', () => {
  const web = buildWebTraffic([{ channel: 'Direct', sessions: 9, keyEvents: 0 }, { channel: 'Organic Search', sessions: 2, keyEvents: 0 }])
  assert.strictEqual(web.warning, LOW_TRAFFIC_NOTE)
})
