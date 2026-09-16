const test = require('node:test')
const assert = require('node:assert')
const { planKeyFor, planLabelFor, parsePlan, planLabelForKey, emptyPlanCounts } = require('./planType')
const { buildPlanRows } = require('./membershipByPlan')

test('ABC term maps to plan type', () => {
  assert.equal(planKeyFor('Installment'), 'one-year')
  assert.equal(planKeyFor('Open'), 'mtm')
  assert.equal(planKeyFor('Cash Open'), 'no-draft')
  assert.equal(planKeyFor('Cash'), 'pif')
  assert.equal(planKeyFor(' open '), 'mtm')
  assert.equal(planKeyFor(null), 'unknown')
  assert.equal(planKeyFor('Something New'), 'unknown')
  assert.equal(planLabelFor('Installment'), '1-Year')
  assert.equal(planLabelFor(''), 'Unknown')
})

test('parsePlan accepts known keys only', () => {
  assert.equal(parsePlan('one-year'), 'one-year')
  assert.equal(parsePlan('MTM'), 'mtm')
  assert.equal(parsePlan('annual'), null)
  assert.equal(parsePlan(undefined), null)
  assert.equal(planLabelForKey('pif'), 'Paid in Full')
  assert.deepEqual(Object.keys(emptyPlanCounts()), ['one-year', 'mtm', 'no-draft', 'pif', 'unknown'])
})

test('buildPlanRows keeps fixed order, zero-fills, hides empty Unknown', () => {
  const rows = buildPlanRows(
    [{ plan: 'mtm', members: '10', joined: '3', left_count: '1' }],
    [{ plan: 'mtm', members: '9', joined: '2', left_count: '2' }],
  )
  assert.deepEqual(rows.map(r => r.plan), ['one-year', 'mtm', 'no-draft', 'pif'])
  const mtm = rows[1]
  assert.equal(mtm.label, 'Month-to-Month')
  assert.equal(mtm.members, 10)
  assert.equal(mtm.net, 2)
  assert.equal(mtm.priorNet, 0)
  assert.equal(rows[0].members, 0)
  assert.equal(buildPlanRows([{ plan: 'unknown', members: 9 }], []).at(-1).plan, 'unknown')
})
