const test = require('node:test')
const assert = require('node:assert/strict')
const { isMilestone, alertText, earliestJoin, isEligible, planAlert, MAX_TEXT } = require('./checkinMilestones')

const active = (extra = {}) => ({
  is_active: true, member_status: 'Active', membership_type: 'MONTHLY',
  sign_date: '2025-06-01', begin_date: '', since_date: null, ...extra,
})
const none = new Set()

test('isMilestone: the fixed list, then every 100 after 300', () => {
  for (const n of [10, 25, 50, 100, 150, 200, 250, 300, 400, 1000, 1500]) assert.equal(isMilestone(n), true, n)
  for (const n of [9, 11, 350, 450, 0, -10, NaN, 10.5]) assert.equal(isMilestone(n), false, n)
})

test('alertText: fits ABC 22 chars, drops the ! when it has to', () => {
  assert.equal(alertText(10), 'CELEBRATE 10TH VISIT!')
  assert.equal(alertText(100), 'CELEBRATE 100TH VISIT!')
  assert.equal(alertText(1000), 'CELEBRATE 1000TH VISIT')
  assert.equal(alertText(10000), null)
  for (let n = 1; n < 10000; n++) {
    if (!isMilestone(n)) continue
    const t = alertText(n)
    assert.ok(t.length <= MAX_TEXT, t)
    assert.match(t, /^[A-Z0-9 ,_!%+\-@^]+$/)
  }
})

test('earliestJoin: earliest parseable of sign/begin/since', () => {
  assert.equal(earliestJoin({ sign_date: '2026-03-01', begin_date: '2026-03-05', since_date: '2019-01-10' }), '2019-01-10')
  assert.equal(earliestJoin({ sign_date: '  ', begin_date: '2025-02-03T00:00:00', since_date: 'n/a' }), '2025-02-03')
  assert.equal(earliestJoin({ sign_date: '', begin_date: null }), null)
})

test('isEligible: active, not excluded, joined on/after backfill start', () => {
  const start = '2025-01-01'
  assert.equal(isEligible(active(), none, start), true)
  assert.equal(isEligible(active({ sign_date: '2025-01-01' }), none, start), true)
  assert.equal(isEligible(active({ is_active: false }), none, start), false)
  assert.equal(isEligible(active({ member_status: 'Inactive' }), none, start), false)
  assert.equal(isEligible(active({ membership_type: 'NON-MEMBER' }), new Set(['NON-MEMBER']), start), false)
  assert.equal(isEligible(active({ since_date: '2024-12-31' }), none, start), false)
  assert.equal(isEligible(active({ sign_date: '' }), none, start), false)
  assert.equal(isEligible(active(), none, null), false)
})

test('planAlert: one visit short of a milestone', () => {
  const args = { member: active(), excludedTypes: none, backfillStart: '2025-01-01' }
  assert.deepEqual(planAlert({ ...args, visits: 9 }), { milestone: 10, text: 'CELEBRATE 10TH VISIT!' })
  assert.equal(planAlert({ ...args, visits: 10 }), null)
  assert.equal(planAlert({ ...args, visits: 399 }).milestone, 400)
  assert.equal(planAlert({ ...args, member: active({ is_active: false }), visits: 9 }), null)
})
