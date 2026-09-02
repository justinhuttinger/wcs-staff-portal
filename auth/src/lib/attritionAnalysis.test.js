const test = require('node:test')
const assert = require('node:assert')
const {
  buildAttritionAnalysis, isInsuranceType, tenureMonths, bucketFor, LOST_STATUSES,
} = require('./attritionAnalysis')

const cancel = (over = {}) => ({
  first_name: 'Jane', last_name: 'Doe',
  membership_type: 'CORE', agreement_number: 'A1',
  member_status: 'Cancelled', member_status_date: '2026-08-10',
  since_date: '2025-08-10', sales_person_name: 'Sam Seller',
  ...over,
})

const stat = (out, key) => out.stats.find(s => s.key === key)

// ---------------------------------------------------------------------------
// The insurance split, which is the reason this report exists separately.
// ---------------------------------------------------------------------------

test('A2 and Active and Fit plans are insurance, whatever the casing', () => {
  assert.equal(isInsuranceType('A2 CORE'), true)
  assert.equal(isInsuranceType('a2 exec'), true)
  assert.equal(isInsuranceType('Active and Fit Limited'), true)
  assert.equal(isInsuranceType('ACTIVE AND FIT'), true)
})

test('a paying membership is not insurance', () => {
  assert.equal(isInsuranceType('CORE'), false)
  assert.equal(isInsuranceType('Premier'), false)
  assert.equal(isInsuranceType(null), false)
})

test('the two halves split and sum back to the total', () => {
  const out = buildAttritionAnalysis([
    cancel(),
    cancel({ membership_type: 'A2 CORE' }),
    cancel({ membership_type: 'Active and Fit Limited' }),
  ], [])
  assert.equal(stat(out, 'total').value, 3)
  assert.equal(stat(out, 'membership').value, 1)
  assert.equal(stat(out, 'insurance').value, 2)
})

// ---------------------------------------------------------------------------
// Agreements vs members: a family membership is several rows and one thing
// that was cancelled.
// ---------------------------------------------------------------------------

test('agreements count the membership, not the people on it', () => {
  const out = buildAttritionAnalysis([
    cancel({ agreement_number: 'A1' }),
    cancel({ agreement_number: 'A1', first_name: 'John' }),
    cancel({ agreement_number: 'A2' }),
  ], [])
  assert.equal(stat(out, 'total').value, 3)
  assert.equal(stat(out, 'agreements').value, 2)
})

// ---------------------------------------------------------------------------
// Tenure.
// ---------------------------------------------------------------------------

test('tenure is whole months from joining to ending', () => {
  // Jan to Aug is seven calendar months. The old 30.44-day arithmetic said
  // six, which is where this number came from before.
  assert.equal(tenureMonths('2026-01-01', '2026-08-01'), 7)
  assert.equal(tenureMonths('2025-08-10', '2026-08-10'), 12)
  // Joined on the 10th, left on the 9th: not yet a full month.
  assert.equal(tenureMonths('2026-07-10', '2026-08-09'), 0)
  assert.equal(tenureMonths('2026-08-01', '2026-08-20'), 0)
})

test('a missing join date gives unknown tenure, not zero', () => {
  assert.equal(tenureMonths(null, '2026-08-01'), null)
})

test('buckets are half-open so a boundary lands in exactly one', () => {
  assert.equal(bucketFor(0).label, 'Under 1 month')
  assert.equal(bucketFor(1).label, '1-3 months')
  assert.equal(bucketFor(3).label, '3-6 months')
  assert.equal(bucketFor(12).label, '1-2 years')
  assert.equal(bucketFor(24).label, 'Over 2 years')
  assert.equal(bucketFor(240).label, 'Over 2 years')
})

// A member with no join date has unknown tenure, and must be counted somewhere
// rather than silently dropped out of the breakdown.
test('unknown tenure gets its own row rather than vanishing', () => {
  const out = buildAttritionAnalysis([cancel({ since_date: null })], [])
  const rows = out.breakdowns.byTenure
  assert.equal(rows.find(r => r.label === 'Unknown').count, 1)
  assert.equal(rows.reduce((n, r) => n + r.count, 0), 1)
})

test('average tenure ignores the ones with no join date', () => {
  const out = buildAttritionAnalysis([
    cancel({ since_date: '2025-08-10' }),  // 12 months
    cancel({ since_date: null }),          // unknown
  ], [])
  assert.equal(stat(out, 'avgTenure').value, 12)
})

test('nobody with a known join date leaves average tenure unknown, not zero', () => {
  const out = buildAttritionAnalysis([cancel({ since_date: null })], [])
  assert.equal(stat(out, 'avgTenure').value, null)
})

// ---------------------------------------------------------------------------
// Attribution.
// ---------------------------------------------------------------------------

// An insurance cancellation is the provider's decision, not a salesperson's
// outcome, so it must not land on their row.
test('the salesperson breakdown covers paying memberships only', () => {
  const out = buildAttritionAnalysis([
    cancel({ sales_person_name: 'Sam Seller' }),
    cancel({ sales_person_name: 'Sam Seller', membership_type: 'A2 CORE' }),
  ], [])
  assert.equal(out.breakdowns.bySalesperson.find(r => r.label === 'Sam Seller').count, 1)
})

// ---------------------------------------------------------------------------
// The queue.
// ---------------------------------------------------------------------------

test('pending cancels are listed soonest first, because it is a queue to work', () => {
  const out = buildAttritionAnalysis([], [
    { first_name: 'Late', last_name: 'One', member_status_date: '2026-12-01' },
    { first_name: 'Soon', last_name: 'One', member_status_date: '2026-09-05' },
  ])
  assert.deepEqual(out.pending.map(p => p.member), ['Soon One', 'Late One'])
  assert.equal(stat(out, 'pending').value, 2)
})

test('an empty range is inactive rather than an error', () => {
  const out = buildAttritionAnalysis([], [])
  assert.equal(out.hasActivity, false)
  assert.equal(stat(out, 'total').value, 0)
})

// A queue with nobody lost is still activity worth showing.
test('a queue with no cancels still counts as activity', () => {
  const out = buildAttritionAnalysis([], [{ first_name: 'A', last_name: 'B' }])
  assert.equal(out.hasActivity, true)
})

test('the statuses are the three ABC uses for an ended membership', () => {
  assert.deepEqual(LOST_STATUSES, ['Cancelled', 'Expired', 'Return For Collection'])
})
