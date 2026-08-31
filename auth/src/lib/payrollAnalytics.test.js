const test = require('node:test')
const assert = require('node:assert')
const { buildPayroll } = require('./payrollAnalytics')

const row = (over = {}) => ({
  slug: 'medford', employee: 'Ryan Harris',
  sales_commission: 12.51, recurring_commission: 1640.40, total_commission: 1652.91,
  sales_lines: 3, recurring_lines: 12, shared_name: false, ...over,
})

const periods = [
  { period: '2026-08-01', has_sales: false, has_recurring: true },
  { period: '2026-07-01', has_sales: true, has_recurring: true },
]

test('both commission sources are carried and totalled', () => {
  const out = buildPayroll([row()], periods, { period: '2026-07-01' })
  const p = out.people[0]
  assert.equal(p.sales, 12.51)
  assert.equal(p.recurring, 1640.4)
  assert.equal(p.total, 1652.91)
  assert.equal(out.summary.total, 1652.91)
})

test('a person appears once per club, not pooled across them', () => {
  // Ryan Harris earns at Medford and Eugene in the same month, and the sales
  // export is per club — pooling would hide which club owes what.
  const out = buildPayroll([
    row({ slug: 'medford', total_commission: 1652.91 }),
    row({ slug: 'eugene', sales_commission: 13.5, recurring_commission: 0, total_commission: 13.5 }),
  ], periods, { period: '2026-07-01' })

  assert.equal(out.people.length, 2)
  assert.deepEqual(out.byClub.map(c => c.slug), ['medford', 'eugene'])
})

// --- a missing upload is not a quiet month ---------------------------------

test('a period with no sales upload says so', () => {
  // Otherwise everyone's pay reads as short and people come to argue about it.
  const out = buildPayroll([row({ sales_commission: 0, total_commission: 1640.4 })],
    periods, { period: '2026-08-01' })

  assert.equal(out.summary.hasSales, false)
  assert.match(out.notes.missingSource, /No sales commission has been uploaded/)
  assert.match(out.notes.missingSource, /will rise when it is/)
})

test('a complete period raises no warning', () => {
  const out = buildPayroll([row()], periods, { period: '2026-07-01' })
  assert.equal(out.summary.hasSales, true)
  assert.equal(out.notes.missingSource, null)
})

test('the reverse gap is reported too', () => {
  const out = buildPayroll([row()], [
    { period: '2026-07-01', has_sales: true, has_recurring: false },
  ], { period: '2026-07-01' })
  assert.match(out.notes.missingSource, /No recurring commission/)
})

// --- a shared commission row -----------------------------------------------

test('a row naming two people is flagged, not guessed at', () => {
  // The money is real; the attribution is not.
  const out = buildPayroll([
    row(),
    row({ employee: 'Victoria Mattox, Devyn Trebesch', shared_name: true, total_commission: 13 }),
  ], periods, { period: '2026-07-01' })

  assert.equal(out.shared.length, 1)
  assert.match(out.notes.shared, /cannot be attributed/)
  assert.match(out.notes.shared, /split it by hand/)
})

test('a shared row still counts toward the club total', () => {
  // Dropping it would make the report disagree with the payroll run.
  const out = buildPayroll([
    row({ total_commission: 100, sales_commission: 100, recurring_commission: 0 }),
    row({ employee: 'A, B', shared_name: true, total_commission: 13, sales_commission: 13, recurring_commission: 0 }),
  ], periods, { period: '2026-07-01' })

  assert.equal(out.summary.total, 113)
  assert.equal(out.byClub[0].total, 113)
})

test('with no shared rows there is no warning', () => {
  const out = buildPayroll([row()], periods, { period: '2026-07-01' })
  assert.equal(out.notes.shared, null)
})

// --- misc -------------------------------------------------------------------

test('the period defaults to the newest available', () => {
  const out = buildPayroll([], periods, {})
  assert.equal(out.period, '2026-08-01')
})

test('an empty period produces zeroes rather than NaN', () => {
  const out = buildPayroll([], periods, { period: '2026-07-01' })
  assert.equal(out.summary.total, 0)
  assert.equal(out.summary.people, 0)
  assert.deepEqual(out.byClub, [])
})

test('people are ordered by total, highest first', () => {
  const out = buildPayroll([
    row({ employee: 'Small', total_commission: 10 }),
    row({ employee: 'Big', total_commission: 900 }),
  ], periods, { period: '2026-07-01' })
  // The route returns them ordered; the builder must not resort them wrongly.
  assert.equal(out.people.length, 2)
  assert.equal(out.summary.total, 910)
})
