const test = require('node:test')
const assert = require('node:assert')
const { PLAN_TYPES, planKeyFor, planLabelFor, parsePlan, planLabelForKey, emptyPlanCounts } = require('./planType')

test('three plans only', () => {
  assert.deepEqual(PLAN_TYPES.map(p => p.label), ['1-Year', 'Month-to-Month', 'Paid in Full'])
  assert.deepEqual(Object.keys(emptyPlanCounts()), ['one-year', 'mtm', 'pif'])
})

test('ABC term maps to plan type; everything unnamed is month-to-month', () => {
  assert.equal(planKeyFor('Installment'), 'one-year')
  assert.equal(planKeyFor('Cash'), 'pif')
  assert.equal(planKeyFor('Open'), 'mtm')
  assert.equal(planKeyFor('Cash Open'), 'mtm')
  assert.equal(planKeyFor(' open '), 'mtm')
  assert.equal(planKeyFor(null), 'mtm')
  assert.equal(planKeyFor('Something New'), 'mtm')
  assert.equal(planLabelFor('Installment'), '1-Year')
  assert.equal(planLabelFor(''), 'Month-to-Month')
})

test('parsePlan accepts the three keys only', () => {
  assert.equal(parsePlan('one-year'), 'one-year')
  assert.equal(parsePlan('MTM'), 'mtm')
  assert.equal(parsePlan('no-draft'), null)
  assert.equal(parsePlan('unknown'), null)
  assert.equal(parsePlan(undefined), null)
  assert.equal(planLabelForKey('pif'), 'Paid in Full')
})
