import test from 'node:test'
import assert from 'node:assert/strict'
import { OUTCOMES, VIP_PASS, CUSTOM_PASS, DAY_PASS, grantsAPass, passDaysFor, passRuleFor } from './outcomes.js'

test('both front ends see the same six outcomes, longest access first', () => {
  assert.deepEqual(OUTCOMES, [
    'Membership Sale', 'Started Trial', 'Started VIP Pass', 'Day Pass', 'Only Tour', 'Custom Pass',
  ])
})

// This list is a copy of the tour_outcomes table, which the kiosk reads
// directly. The copy is what lets the two drift, so the ordering and lengths
// here are pinned against the seed in auth/migrations/199_tour_outcome_day_pass.sql
// and 148_tour_outcomes_kiosk_vocabulary.sql.
test('the order matches the sort_order the table stores', () => {
  const SORT_ORDER = {
    'Membership Sale': 10, 'Started Trial': 20, 'Started VIP Pass': 30,
    'Day Pass': 35, 'Only Tour': 40, 'Custom Pass': 50,
  }
  const sorted = [...OUTCOMES].sort((a, b) => SORT_ORDER[a] - SORT_ORDER[b])
  assert.deepEqual(OUTCOMES, sorted)
})

test('a day pass is one day, with nothing for staff to type', () => {
  assert.equal(grantsAPass(DAY_PASS), true)
  assert.equal(passDaysFor(DAY_PASS).days, 1)
  // The length comes from the outcome, so a number typed alongside is ignored
  // rather than quietly overriding it the way a custom pass would.
  assert.equal(passDaysFor(DAY_PASS, '30').days, 1)
})

test('a sale or a plain tour hands out nothing', () => {
  assert.equal(grantsAPass('Membership Sale'), false)
  assert.equal(grantsAPass('Only Tour'), false)
  assert.equal(passDaysFor('Only Tour', '10').days, null)
})

test('trial and VIP carry their fixed lengths', () => {
  assert.equal(passDaysFor('Started Trial').days, 7)
  assert.equal(passDaysFor(VIP_PASS).days, 14)
})

test('a custom pass takes whatever staff typed', () => {
  assert.equal(passDaysFor(CUSTOM_PASS, '30').days, 30)
})

test('rejects a fat-fingered length rather than writing it to ABC', () => {
  for (const bad of ['0', '91', '', 'ten', '7.5']) {
    const r = passDaysFor(CUSTOM_PASS, bad)
    assert.equal(r.days, null, `expected ${bad} to be rejected`)
    assert.match(r.error, /1 and 90/)
  }
})

// The server's list (set in Admin -> Tour Check-In) overrides the built-in one.
const RULES = [
  { outcome: 'Started Trial', grants_pass: true, pass_days: 10 },
  { outcome: 'Custom Pass', grants_pass: true, pass_days: null },
  { outcome: 'Punch Card', grants_pass: true, pass_days: 30 },
  { outcome: 'Guest', grants_pass: false, pass_days: null },
]

test('server rules decide the length when they are sent', () => {
  assert.equal(passDaysFor('Started Trial', '', RULES).days, 10)
  assert.equal(passDaysFor('Punch Card', '', RULES).days, 30)
  assert.equal(passDaysFor('Custom Pass', '5', RULES).days, 5)
  assert.equal(grantsAPass('Guest', RULES), false)
  // Not in this club's list: hands out nothing, even if the built-in list says otherwise.
  assert.equal(grantsAPass(DAY_PASS, RULES), false)
  assert.deepEqual(passRuleFor('Custom Pass', RULES), { grants: true, fixedDays: null })
})

test('no rules from the server falls back to the built-in lengths', () => {
  assert.equal(passDaysFor('Started Trial', '', null).days, 7)
  assert.equal(passDaysFor('Started Trial', '', []).days, 7)
})
