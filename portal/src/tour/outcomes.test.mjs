import test from 'node:test'
import assert from 'node:assert/strict'
import { OUTCOMES, VIP_PASS, CUSTOM_PASS, grantsAPass, passDaysFor } from './outcomes.js'

test('both front ends see the same five outcomes', () => {
  assert.deepEqual(OUTCOMES, [
    'Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour', 'Custom Pass',
  ])
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
