const test = require('node:test')
const assert = require('node:assert')
const { buildAttritionTrends, metricsFor, trendLine } = require('./attritionTrends')

const row = (over = {}) => ({
  month_start: '2026-07-01', segment: '30935',
  members: 1000, lost_members: 30,
  monthly_dues_lost: 600, monthly_revenue_lost: 900,
  ...over,
})

test('annual is the monthly figure projected over a year', () => {
  const m = metricsFor(row())
  assert.equal(m.monthly_dues_lost, 600)
  assert.equal(m.annual_dues_lost, 7200)
  assert.equal(m.annual_revenue_lost, 10800)
})

test('per-member divides by members LOST, not by the base', () => {
  const m = metricsFor(row())
  // What the average leaver was worth, not what a leaver costs the whole club.
  assert.equal(m.avg_monthly_dues_per_member, 20)
  assert.equal(m.avg_annual_dues_per_member, 240)
  assert.equal(m.avg_monthly_revenue_per_member, 30)
})

test('a month with no base has no attrition rate, and no lost members has no average', () => {
  // Zero would draw the line to the axis as though nobody left.
  assert.equal(metricsFor(row({ members: 0 })).attrition_pct, null)
  assert.equal(metricsFor(row({ lost_members: 0 })).avg_monthly_dues_per_member, null)
  // The raw totals are still real at zero.
  assert.equal(metricsFor(row({ lost_members: 0 })).lost_members, 0)
})

test('overall is pooled from the raw counts, never averaged from the segments', () => {
  const rows = [
    row({ segment: 'small', members: 100, lost_members: 10 }),   // 10%
    row({ segment: 'big', members: 3900, lost_members: 78 }),    // 2%
  ]
  const out = buildAttritionTrends(rows, 'attrition_pct', { segment: 'club' })
  // Pooled: 88 of 4000 = 2.2%. Averaging the two rates would say 6%, a figure
  // neither segment had and the club never experienced.
  assert.equal(out.overall.points[0].value, 2.2)
})

test('segments are ranked by base size, not by the metric', () => {
  const rows = [
    row({ segment: 'tiny', members: 10, lost_members: 9 }),
    row({ segment: 'huge', members: 5000, lost_members: 50 }),
  ]
  const out = buildAttritionTrends(rows, 'attrition_pct', { segment: 'club' })
  // 'tiny' has a 90% rate but ten members. Ranking on the metric would promote
  // it above a segment 500 times its size.
  assert.equal(out.series[0].key, 'huge')
})

test('the trend line skips gaps rather than treating them as zero', () => {
  const flat = trendLine([{ value: 10 }, { value: null }, { value: 10 }])
  // A null read as 0 would slope this steeply down and back up.
  assert.equal(flat.slope, 0)
  assert.equal(trendLine([{ value: 5 }]), null)

  const rising = trendLine([{ value: 1 }, { value: 2 }, { value: 3 }])
  assert.equal(rising.slope, 1)
  assert.equal(rising.from, 1)
  assert.equal(rising.to, 3)
})

test('an unknown metric falls back rather than rendering blank', () => {
  const out = buildAttritionTrends([row()], 'not_a_metric', {})
  assert.equal(out.metric, 'attrition_pct')
})

test('club segments are named, other segments are passed through', () => {
  const named = buildAttritionTrends([row()], 'lost_members',
    { segment: 'club', clubNameFor: n => (n === '30935' ? 'Salem' : n) })
  assert.equal(named.series[0].label, 'Salem')

  const gender = buildAttritionTrends([row({ segment: 'Female' })], 'lost_members', { segment: 'gender' })
  assert.equal(gender.series[0].label, 'Female')
})

test('months are the union across segments, in order', () => {
  const out = buildAttritionTrends([
    row({ month_start: '2026-08-01', segment: 'a' }),
    row({ month_start: '2026-07-01', segment: 'b' }),
  ], 'lost_members', {})
  assert.deepEqual(out.months, ['2026-07-01', '2026-08-01'])
  // A segment absent in a month gets a point, so the line has a gap rather than
  // silently shifting its remaining points left.
  assert.equal(out.series[0].points.length, 2)
})
