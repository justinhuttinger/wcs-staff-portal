const test = require('node:test')
const assert = require('node:assert')
const { outcomesForLocation, onlyTours } = require('./tourOutcomeRules')

// Mirrors the rows migration 200 leaves in tour_outcomes.
const RULES = [
  { outcome: 'Membership Sale', counts_as_tour: true, location_slugs: null },
  { outcome: 'Started Trial', counts_as_tour: true, location_slugs: null },
  { outcome: 'Started VIP Pass', counts_as_tour: true, location_slugs: null },
  { outcome: 'Day Pass', counts_as_tour: false, location_slugs: null },
  { outcome: 'Only Tour', counts_as_tour: true, location_slugs: null },
  { outcome: 'NLPT', counts_as_tour: false, location_slugs: ['milwaukie', 'clackamas'] },
  { outcome: 'Swim', counts_as_tour: false, location_slugs: ['milwaukie', 'clackamas'] },
  { outcome: 'Custom Pass', counts_as_tour: true, location_slugs: null },
]

test('NLPT and Swim are offered at Milwaukie and Clackamas', () => {
  for (const club of ['Milwaukie', 'Clackamas', ' clackamas ']) {
    const list = outcomesForLocation(RULES, club)
    assert.ok(list.includes('NLPT'), club)
    assert.ok(list.includes('Swim'), club)
  }
})

test('the other clubs keep the list they had', () => {
  assert.deepStrictEqual(outcomesForLocation(RULES, 'Salem'), [
    'Membership Sale', 'Started Trial', 'Started VIP Pass', 'Day Pass', 'Only Tour', 'Custom Pass',
  ])
})

test('Day Pass, NLPT and Swim are not tours', () => {
  const rows = ['Started Trial', 'Day Pass', 'NLPT', 'Swim', 'Only Tour', null]
    .map((outcome, id) => ({ id, outcome }))
  assert.deepStrictEqual(onlyTours(rows, RULES).map(r => r.outcome), ['Started Trial', 'Only Tour', null])
})

test('no rules means every row still counts', () => {
  const rows = [{ outcome: 'Day Pass' }, { outcome: 'Only Tour' }]
  assert.strictEqual(onlyTours(rows, []).length, 2)
})
