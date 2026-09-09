const test = require('node:test')
const assert = require('node:assert')
const { buildAverageDues, monthlyDues } = require('./averageDues')

let seq = 0
const m = (over = {}) => ({
  member_id: `M${++seq}`, club_number: '30935', membership_type: 'SINGLE',
  agreement_number: `A${seq}`, is_primary_member: true,
  next_due_amount: 80, payment_frequency: 'Monthly', ...over,
})

/** A family: one agreement, several member rows, an amount stamped on each. */
const family = (agr, amounts) => amounts.map(([amount, primary], i) =>
  m({ agreement_number: agr, is_primary_member: primary, next_due_amount: amount,
      member_id: `${agr}-${i}` }))

const row = (out, key) => out.rows.find(r => r.key === key)

// ---------------------------------------------------------------------------
// next_due_amount is not a monthly figure. This is the trap the whole report
// turns on.
// ---------------------------------------------------------------------------

test('a monthly charge is taken as it stands', () => {
  assert.strictEqual(monthlyDues(80, 'Monthly'), 80)
})

test('a bi-weekly charge is 26 a year, not 24', () => {
  // Two months in twelve carry three charges. Treating it as twice a month
  // understates a fortnightly member by 8%.
  assert.strictEqual(Math.round(monthlyDues(19.49, 'Bi-Weekly') * 100) / 100, 42.23)
})

test('an annual charge is spread over the year', () => {
  assert.strictEqual(monthlyDues(354, 'Annually'), 29.5)
})

test('a charge with no frequency cannot be made monthly, and is not guessed at', () => {
  // Eleven live members carry one of these, averaging $706 and running to
  // $1,140 — a paid-up-front sum, not a monthly rate.
  assert.strictEqual(monthlyDues(1140, null), null)
  assert.strictEqual(monthlyDues(706, ''), null)
  assert.strictEqual(monthlyDues(80, 'Every Other Thursday'), null)
})

test('nothing to pay is null, never zero', () => {
  // Zero would put the member in the average as though they were charged
  // nothing, which is a different claim from having no recurring charge.
  assert.strictEqual(monthlyDues(0, 'Monthly'), null)
  assert.strictEqual(monthlyDues(null, 'Monthly'), null)
})

// ---------------------------------------------------------------------------
// The denominator
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dues are billed per AGREEMENT. Summing the member rows is how this report
// first shipped claiming $877k of monthly dues against about $624k collected.
// ---------------------------------------------------------------------------

test('a family is one bill, not one per member', () => {
  // ABC stamps an amount on every row of the agreement. Measured against what
  // 1,028 real family agreements were billed in August: summing gives $415
  // where the bill was $128, and the primary's row gives $124.
  const out = buildAverageDues(family('F1', [[130, true], [130, false], [95, false]]),
    { basis: 'agreements' })
  assert.strictEqual(out.summary.totalDues, 130)
  assert.strictEqual(out.summary.agreements, 1)
  assert.strictEqual(out.summary.membersCovered, 3)
  assert.strictEqual(out.summary.avgDues, 130)
})

test('the primary row is the bill even when a secondary carries more', () => {
  // The rows within an agreement disagree in 863 of 1,193 two-member cases.
  // The primary's is the one that matched the billed figure.
  const out = buildAverageDues(family('F1', [[100, true], [140, false]]),
    { basis: 'agreements' })
  assert.strictEqual(out.summary.totalDues, 100)
})

test('with no row flagged primary the largest is taken, not the first', () => {
  // The smallest would systematically understate; the largest matched the bill
  // in every family checked.
  const out = buildAverageDues(family('F1', [[60, false], [130, false]]),
    { basis: 'agreements' })
  assert.strictEqual(out.summary.totalDues, 130)
})

test('the basis decides the denominator, never the total', () => {
  const rows = [
    ...family('F1', [[120, true], [120, false]]),
    m({ agreement_number: 'S1', next_due_amount: 60 }),
  ]
  const perAgreement = buildAverageDues(rows, { basis: 'agreements' })
  const perMember = buildAverageDues(rows, { basis: 'members' })
  // Same money either way: 120 + 60.
  assert.strictEqual(perAgreement.summary.totalDues, 180)
  assert.strictEqual(perMember.summary.totalDues, 180)
  // Two agreements, three members.
  assert.strictEqual(perAgreement.summary.avgDues, 90)
  assert.strictEqual(perMember.summary.avgDues, 60)
})

test('a member with no agreement number stands alone', () => {
  // Pooling them under one blank key would merge unrelated people into one
  // enormous "agreement" and report a single huge bill.
  const out = buildAverageDues([
    m({ agreement_number: null, next_due_amount: 50 }),
    m({ agreement_number: null, next_due_amount: 70 }),
  ], { basis: 'agreements' })
  assert.strictEqual(out.summary.agreements, 2)
  assert.strictEqual(out.summary.totalDues, 120)
})

test('members with no recurring charge are set aside, not averaged in', () => {
  // Cash and Cash Open members paid up front. Leaving them in the denominator
  // divides the same total by a bigger number and reports an average nobody
  // is charged.
  const out = buildAverageDues([
    m({ next_due_amount: 80 }),
    m({ next_due_amount: 100 }),
    m({ next_due_amount: 0 }),
    m({ next_due_amount: null }),
  ])
  assert.strictEqual(out.summary.agreements, 2)
  assert.strictEqual(out.summary.avgDues, 90)
  assert.strictEqual(out.summary.noCharge, 2)
})

test('an unusable frequency is excluded and counted, not left to lift the average', () => {
  const out = buildAverageDues([
    m({ next_due_amount: 80 }),
    m({ next_due_amount: 1140, payment_frequency: null }),
  ])
  assert.strictEqual(out.summary.agreements, 1)
  assert.strictEqual(out.summary.avgDues, 80)
  assert.strictEqual(out.summary.unknownFrequency, 1)
})

test('a bi-weekly member is normalised before being averaged', () => {
  const out = buildAverageDues([
    m({ next_due_amount: 60, payment_frequency: 'Monthly' }),
    m({ next_due_amount: 19.49, payment_frequency: 'Bi-Weekly' }),
  ])
  // (60 + 42.23) / 2, not (60 + 19.49) / 2 = 39.75
  assert.strictEqual(out.summary.avgDues, 51.12)
})

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

test('the overall average comes from the totals, not from averaging the averages', () => {
  // A mean of means weights a 1-member club the same as a 3-member one and is
  // simply a different, wrong number: here it would give 90, not 75.
  const out = buildAverageDues([
    m({ club_number: '30935', next_due_amount: 50 }),
    m({ club_number: '30935', next_due_amount: 50 }),
    m({ club_number: '30935', next_due_amount: 50 }),
    m({ club_number: '31599', next_due_amount: 150 }),
  ])
  assert.strictEqual(out.summary.agreements, 4)
  assert.strictEqual(out.summary.avgDues, 75)
  assert.strictEqual(row(out, '30935').avgDues, 50)
  assert.strictEqual(row(out, '31599').avgDues, 150)
})

test('a row where nobody pays dues reports no average rather than $0.00', () => {
  const out = buildAverageDues([m({ next_due_amount: 0 })])
  assert.strictEqual(row(out, '30935').avgDues, null)
  assert.strictEqual(row(out, '30935').noCharge, 1)
  assert.strictEqual(out.hasActivity, false)
})

test('by membership type, the row is the plan rather than the club', () => {
  const out = buildAverageDues([
    m({ membership_type: 'SINGLE', next_due_amount: 80 }),
    m({ membership_type: 'COUPLE', next_due_amount: 120, club_number: '31599' }),
  ], { viewBy: 'membership_type' })
  assert.deepStrictEqual(out.rows.map(r => r.label).sort(), ['COUPLE', 'SINGLE'])
  assert.strictEqual(row(out, 'COUPLE').avgDues, 120)
})
