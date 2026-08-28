const test = require('node:test')
const assert = require('node:assert')
const { buildPosSales, marginOf, MIN_COST_COVERAGE_PCT } = require('./posSales')

const m = (slug, over = {}) => ({
  month: '2026-08-01', slug,
  transactions: 100,
  retail_revenue: 1000, retail_cogs: 600, retail_units: 50, retail_costed_revenue: 900,
  passthrough_revenue: 5000, retail_returns: 0, passthrough_returns: -100,
  ...over,
})

// --- the central trap ------------------------------------------------------
//
// Only 10.9% of POS revenue carries a unit cost, because 89% of it is
// pass-through. Treating missing costs as zero reports a 92.7% margin against a
// true 33.5%.

test('margin is computed over COSTED revenue, not all retail revenue', () => {
  // $900 costed of $1000 retail, $600 cost. Margin is 300/900 = 33.3%,
  // NOT (1000-600)/1000 = 40%.
  const out = buildPosSales([m('salem')], [], [])
  assert.equal(out.summary.marginPct, 33.3)
  assert.notEqual(out.summary.marginPct, 40)
})

test('margin is suppressed when almost nothing is costed', () => {
  // Milwaukie: $55 costed of $2,955 retail. A margin from that is meaningless.
  const out = buildPosSales([
    m('milwaukie', { retail_revenue: 2955, retail_costed_revenue: 55, retail_cogs: 49 }),
  ], [], [])

  assert.equal(out.summary.marginPct, null)
  assert.equal(out.summary.grossProfit, null)
  assert.equal(out.summary.costCoverage, 1.9)
  // Revenue is still reported — it is accurate, only the margin is not.
  assert.equal(out.summary.retailRevenue, 2955)
})

test('the low-coverage club is named so the gap can be chased', () => {
  const out = buildPosSales([
    m('salem'),
    m('milwaukie', { retail_revenue: 2955, retail_costed_revenue: 55, retail_cogs: 49 }),
  ], [], [])

  assert.equal(out.lowCoverage.length, 1)
  assert.equal(out.lowCoverage[0].slug, 'milwaukie')
  assert.match(out.notes.coverage, /milwaukie \(1\.9%/)
  assert.match(out.notes.coverage, /left blank rather than guessed/)
})

test('marginOf holds the line exactly at the threshold', () => {
  const at = marginOf(50, 25, 100)       // exactly 50% coverage
  assert.equal(at.costCoverage, MIN_COST_COVERAGE_PCT)
  assert.equal(at.reliable, true)
  assert.equal(at.marginPct, 50)

  const below = marginOf(49, 25, 100)
  assert.equal(below.reliable, false)
  assert.equal(below.marginPct, null)
})

test('marginOf does not divide by zero on a club with no retail', () => {
  const none = marginOf(0, 0, 0)
  assert.equal(none.marginPct, null)
  assert.equal(none.costCoverage, null)
  assert.equal(none.reliable, false)
})

// --- streams ---------------------------------------------------------------

test('pass-through revenue is never folded into retail', () => {
  const out = buildPosSales([m('salem')], [], [])
  assert.equal(out.summary.retailRevenue, 1000)
  assert.equal(out.summary.passthroughRevenue, 5000)
  assert.equal(out.summary.totalRevenue, 6000)
  // And the margin is computed only against retail.
  assert.equal(out.summary.marginPct, 33.3)
})

test('returns are kept apart by stream', () => {
  // Clackamas: $19,280 of pass-through refunds against $36 of actual product
  // returns. One combined figure beside retail would read as a catastrophic
  // return rate on goods.
  const out = buildPosSales([
    m('clackamas', { retail_revenue: 8249, retail_returns: -36, passthrough_returns: -19280 }),
  ], [], [])

  assert.equal(out.summary.retailReturns, -36)
  assert.equal(out.summary.passthroughReturns, -19280)
})

// --- rollups ---------------------------------------------------------------

test('clubs rank by retail revenue, not by total takings', () => {
  // Milwaukie takes the most money overall and sells the least.
  const out = buildPosSales([
    m('springfield', { retail_revenue: 14271, passthrough_revenue: 57246 }),
    m('milwaukie', { retail_revenue: 2955, passthrough_revenue: 67433, retail_costed_revenue: 55, retail_cogs: 49 }),
  ], [], [])

  assert.deepEqual(out.byClub.map(c => c.slug), ['springfield', 'milwaukie'])
})

test('each club carries its own coverage, not the company average', () => {
  const out = buildPosSales([
    m('salem', { retail_revenue: 1000, retail_costed_revenue: 900, retail_cogs: 600 }),
    m('milwaukie', { retail_revenue: 2955, retail_costed_revenue: 55, retail_cogs: 49 }),
  ], [], [])

  const salem = out.byClub.find(c => c.slug === 'salem')
  const mil = out.byClub.find(c => c.slug === 'milwaukie')
  assert.equal(salem.reliable, true)
  assert.equal(mil.reliable, false)
  assert.equal(mil.marginPct, null)
})

test('the trend uses its own window and is ordered', () => {
  const out = buildPosSales([m('salem')], [], [], {
    trendMonthly: [
      m('salem', { month: '2026-07-01', retail_revenue: 900 }),
      m('salem', { month: '2026-05-01', retail_revenue: 700 }),
    ],
  })
  assert.deepEqual(out.months.map(x => x.month), ['2026-05-01', '2026-07-01'])
})

test('period change is null against no prior rather than Infinity', () => {
  const out = buildPosSales([m('salem')], [], [], { priorMonthly: [] })
  assert.equal(out.summary.retailChange, null)
  assert.equal(out.summary.priorRetailRevenue, null)
})

test('products keep their own per-item margin including nulls', () => {
  const out = buildPosSales([m('salem')], [
    { name: 'Tee Shirt', profit_center: 'WCS Merchandise', units: 126, revenue: 3170, cogs: 2206, costed_revenue: 3170, margin_pct: 30.4 },
    { name: 'Beverages', profit_center: 'WCS Drinks', units: 451, revenue: 1701, cogs: 0, costed_revenue: 0, margin_pct: null },
  ], [])

  assert.equal(out.topProducts[0].marginPct, 30.4)
  // An uncosted product shows null, never 100%.
  assert.equal(out.topProducts[1].marginPct, null)
})
