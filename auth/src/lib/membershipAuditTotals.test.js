const test = require('node:test')
const assert = require('node:assert')
const { recombineTotals } = require('./membershipAuditTotals')

test('recombines member-weighted totals across types', () => {
  const byType = [
    { members: 100, paying: 90, non_dues: 10, total_monthly_dues: 6750, tenure_sum_months: 1800, tenure_count: 100, leaks: 5 },
    { members:  50, paying: 10, non_dues: 40, total_monthly_dues:  500, tenure_sum_months:  500, tenure_count:  40, leaks: 0 },
  ]
  const t = recombineTotals(byType)
  assert.equal(t.active_members, 150)
  assert.equal(t.paying_members, 100)
  assert.equal(t.non_dues_members, 50)
  assert.equal(t.total_monthly_dues, 7250)
  assert.equal(t.avg_monthly_dues, 72.5)   // 7250 / 100 paying
  assert.equal(t.avg_tenure_months, 16.4)  // 2300 / 140 (1 dp)
  assert.equal(t.leak_count, 5)
})

test('empty input yields zeros, no divide-by-zero', () => {
  const t = recombineTotals([])
  assert.equal(t.active_members, 0)
  assert.equal(t.avg_monthly_dues, 0)
  assert.equal(t.avg_tenure_months, 0)
})

test('null/undefined input is treated as empty', () => {
  for (const t of [recombineTotals(null), recombineTotals(undefined)]) {
    assert.equal(t.active_members, 0)
    assert.equal(t.avg_monthly_dues, 0)
    assert.equal(t.avg_tenure_months, 0)
    assert.equal(t.leak_count, 0)
  }
})
