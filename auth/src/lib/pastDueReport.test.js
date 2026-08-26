const test = require('node:test')
const assert = require('node:assert')
const { buildPastDue, isChaseable, pct } = require('./pastDueReport')

function member(over = {}) {
  return {
    club_number: '31598',
    member_status: 'Active',
    is_active: true,
    membership_type: 'SINGLE',
    agreement_payment_method: 'EFT',
    past_due_balance: 100,
    late_fee_amount: 10,
    total_past_due_balance: 110,
    ...over,
  }
}

const TOTALS = { 31598: 1000, 31599: 500 }
const NAMES = { 31598: 'Springfield', 31599: 'Keizer' }
const opts = (over = {}) => ({ viewBy: 'club', clubNameFor: n => NAMES[n] || n, ...over })

test('collections, cancelled and pending cancel never count', () => {
  assert.equal(isChaseable(member()), true)
  assert.equal(isChaseable(member({ member_status: 'Problem' })), true)
  assert.equal(isChaseable(member({ member_status: 'Freeze' })), true)
  // The excluded four, whatever is_active happens to say.
  assert.equal(isChaseable(member({ member_status: 'Return For Collection', is_active: false })), false)
  assert.equal(isChaseable(member({ member_status: 'Return For Collection', is_active: true })), false)
  assert.equal(isChaseable(member({ member_status: 'Cancelled', is_active: false })), false)
  assert.equal(isChaseable(member({ member_status: 'Expired', is_active: false })), false)
  assert.equal(isChaseable(member({ member_status: 'Pending Cancel', is_active: true })), false)
  assert.equal(isChaseable(null), false)
})

test('excluded members are dropped from every figure, not just the rows', () => {
  const rows = [
    member({ past_due_balance: 100 }),
    member({ member_status: 'Return For Collection', is_active: false, past_due_balance: 5000 }),
    member({ member_status: 'Pending Cancel', past_due_balance: 900 }),
  ]
  const { summary, excludedRows } = buildPastDue(rows, TOTALS, opts())
  assert.equal(summary.members, 1)
  // The $5,900 of collections and pending-cancel debt is gone, not folded in.
  assert.equal(summary.pastDue, 100)
  assert.equal(excludedRows, 2)
})

test('club account is whatever the ABC total carries beyond dues and late fees', () => {
  const rows = [member({ past_due_balance: 100, late_fee_amount: 10, total_past_due_balance: 175 })]
  const { summary } = buildPastDue(rows, TOTALS, opts())
  assert.equal(summary.pastDue, 100)
  assert.equal(summary.lateFees, 10)
  assert.equal(summary.clubAccount, 65)
  assert.equal(summary.totalOwed, 175)
})

test('a total lower than its parts cannot produce a negative club account', () => {
  // ABC rounding occasionally lands the total under dues + fees.
  const rows = [member({ past_due_balance: 100, late_fee_amount: 10, total_past_due_balance: 100 })]
  assert.equal(buildPastDue(rows, TOTALS, opts()).summary.clubAccount, 0)
})

test('rows group by club and carry their own share of the club membership', () => {
  const rows = [
    member({ club_number: '31598', past_due_balance: 100 }),
    member({ club_number: '31598', past_due_balance: 300 }),
    member({ club_number: '31599', past_due_balance: 50 }),
  ]
  const { rows: out } = buildPastDue(rows, TOTALS, opts())
  const springfield = out.find(r => r.label === 'Springfield')
  assert.equal(springfield.members, 2)
  assert.equal(springfield.pastDue, 400)
  assert.equal(springfield.avgPastDue, 200)
  assert.equal(springfield.largestBalance, 300)
  assert.equal(springfield.pctOfClubMembers, 0.2) // 2 of 1000
  assert.equal(out.find(r => r.label === 'Keizer').pctOfClubMembers, 0.2) // 1 of 500
})

test('the % of members base is the clubs in scope, not the rows shown', () => {
  const rows = [
    member({ club_number: '31598', membership_type: 'SINGLE' }),
    member({ club_number: '31598', membership_type: 'FAMILY' }),
  ]
  const byClub = buildPastDue(rows, TOTALS, opts())
  const byType = buildPastDue(rows, TOTALS, opts({ viewBy: 'membership_type' }))
  // Regrouping must not move the denominator.
  assert.equal(byClub.summary.memberBase, 1500)
  assert.equal(byType.summary.memberBase, 1500)
  assert.equal(byClub.summary.pctOfMembers, byType.summary.pctOfMembers)
  // A non-club grouping has no membership base of its own.
  assert.equal(byType.rows[0].pctOfClubMembers, null)
  assert.deepEqual(byType.rows.map(r => r.label).sort(), ['FAMILY', 'SINGLE'])
})

test('other groupings resolve their own key', () => {
  const rows = [
    member({ member_status: 'Active', agreement_payment_method: 'EFT' }),
    member({ member_status: 'Problem', agreement_payment_method: 'Credit Card' }),
  ]
  assert.deepEqual(
    buildPastDue(rows, TOTALS, opts({ viewBy: 'member_status' })).rows.map(r => r.label).sort(),
    ['Active', 'Problem']
  )
  assert.deepEqual(
    buildPastDue(rows, TOTALS, opts({ viewBy: 'payment_method' })).rows.map(r => r.label).sort(),
    ['Credit Card', 'EFT']
  )
  // An unknown viewBy falls back to club rather than throwing.
  assert.equal(buildPastDue(rows, TOTALS, opts({ viewBy: 'nonsense' })).viewBy, 'club')
})

test('a missing payment method or type groups as Unknown', () => {
  const rows = [member({ agreement_payment_method: null, membership_type: null })]
  assert.equal(buildPastDue(rows, TOTALS, opts({ viewBy: 'payment_method' })).rows[0].label, 'Unknown')
  assert.equal(buildPastDue(rows, TOTALS, opts({ viewBy: 'membership_type' })).rows[0].label, 'Unknown')
})

test('pct guards a zero denominator', () => {
  assert.equal(pct(5, 100), 5)
  assert.equal(pct(5, 0), null)
  assert.equal(pct(452, 19626), 2.3)
})

test('no past-due members yields zeroes rather than throwing', () => {
  const { rows, summary } = buildPastDue([], TOTALS, opts())
  assert.equal(rows.length, 0)
  assert.equal(summary.members, 0)
  assert.equal(summary.pastDue, 0)
  assert.equal(summary.avgPastDue, null)
  assert.equal(summary.pctOfMembers, 0)
})
