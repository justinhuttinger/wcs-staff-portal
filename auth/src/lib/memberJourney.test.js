const test = require('node:test')
const assert = require('node:assert')
const { buildMemberJourney } = require('./memberJourney')

// One row per tenure month per spend group, visit figures repeated on each --
// exactly the shape analytics_member_journey returns.
const rows = [
  { tenure_month: 0, member_months: 100, members: 100, avg_checkins: 4.5, avg_spend: 70, group_name: 'Dues', group_spend: 38 },
  { tenure_month: 0, member_months: 100, members: 100, avg_checkins: 4.5, avg_spend: 70, group_name: 'Training', group_spend: 13 },
  { tenure_month: 1, member_months: 90, members: 90, avg_checkins: 6.1, avg_spend: 30, group_name: 'Dues', group_spend: 8 },
  { tenure_month: 1, member_months: 90, members: 90, avg_checkins: 6.1, avg_spend: 30, group_name: 'Training', group_spend: 12 },
]

test('visit figures are read once per month, not summed across spend groups', () => {
  const out = buildMemberJourney(rows)
  // Two spend groups per month. Summing would report 9.0 check-ins in month 0.
  assert.equal(out.checkins.points[0].value, 4.5)
  assert.equal(out.spendTotal.points[0].value, 70)
  assert.equal(out.cohort[0].memberMonths, 100)
})

test('the tenure axis is numeric and ordered from month zero', () => {
  const out = buildMemberJourney(rows)
  assert.deepEqual(out.months, [0, 1])
  // Sorted numerically, not as strings -- "10" must not sort before "2".
  const many = buildMemberJourney(
    [2, 10, 1].map(t => ({ tenure_month: t, member_months: 1, members: 1, avg_checkins: 1, avg_spend: 1 }))
  )
  assert.deepEqual(many.months, [1, 2, 10])
})

test('spend series are ranked by total and carry a point for every month', () => {
  const out = buildMemberJourney(rows)
  assert.equal(out.spend[0].label, 'Dues')   // 38 + 8 beats 13 + 12
  assert.equal(out.spend[0].points.length, 2)
  // A group that took nothing in a month really took nothing, so zero is right
  // here -- unlike a rate, where zero and "no data" differ.
  const sparse = buildMemberJourney([
    ...rows,
    { tenure_month: 1, member_months: 90, members: 90, avg_checkins: 6.1, avg_spend: 30, group_name: 'Swim', group_spend: 5 },
  ])
  const swim = sparse.spend.find(s => s.label === 'Swim')
  assert.equal(swim.points[0].value, 0)
  assert.equal(swim.points[1].value, 5)
})

test('a month with no spend at all keeps its check-in point', () => {
  const out = buildMemberJourney([
    { tenure_month: 0, member_months: 10, members: 10, avg_checkins: 3, avg_spend: 0, group_name: null, group_spend: null },
  ])
  // The SQL left-joins spend, so a month nobody bought anything in still
  // returns a row. The visit curve must not develop a hole there.
  assert.equal(out.checkins.points[0].value, 3)
  assert.deepEqual(out.spend, [])
})

test('the cohort size is carried so thin evidence is visible', () => {
  const out = buildMemberJourney(rows)
  assert.equal(out.maxMemberMonths, 100)
  assert.equal(out.cohort[1].memberMonths, 90)
})

test('an empty result builds rather than throwing', () => {
  assert.doesNotThrow(() => buildMemberJourney(null))
  const out = buildMemberJourney([])
  assert.deepEqual(out.months, [])
  assert.deepEqual(out.spend, [])
  // The reason duration is absent travels with the payload.
  assert.ok(out.noDuration.includes('duration'))
})
