const test = require('node:test')
const assert = require('node:assert')
const { buildPtPenetration, pct, pctChange, shiftMonth } = require('./ptPenetration')

const NAMES = { 31598: 'Springfield', 31599: 'Keizer' }
const opts = (over = {}) => ({ clubNameFor: n => NAMES[n] || n, ...over })

function row(month, club, members, ptMembers, recurring = null, pif = 0) {
  return {
    month_start: month + '-01', club_number: club, members,
    pt_members: ptMembers,
    recurring_pt_members: recurring === null ? ptMembers : recurring,
    pif_pt_members: pif,
  }
}

test('pct and pctChange guard zero denominators', () => {
  assert.equal(pct(25, 1000), 2.5)
  assert.equal(pct(1, 0), null)
  assert.equal(pctChange(3, 2), 50)
  assert.equal(pctChange(3, 0), null)
  assert.equal(pctChange(null, 2), null)
})

test('shiftMonth crosses years', () => {
  assert.equal(shiftMonth('2026-07', -12), '2025-07')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
})

test('one line per club, ordered by current size', () => {
  const rows = [
    row('2026-07', '31598', 1000, 30),
    row('2026-07', '31599', 3000, 30),
  ]
  const { series } = buildPtPenetration(rows, opts())
  assert.deepEqual(series.map(s => s.name), ['Keizer', 'Springfield'])
  assert.equal(series.find(s => s.name === 'Springfield').points[0].value, 3)
})

test('a club with no members that month breaks the line instead of reading zero', () => {
  // Medford before it opened: zero members, zero PT, while an established club
  // is trading alongside it. A 0% point would draw a collapse for a club that
  // did not exist yet.
  const rows = [
    row('2026-06', '31598', 0, 0),      // not open
    row('2026-06', '31599', 1000, 20),  // open, so the month is measurable
    row('2026-07', '31598', 1000, 20),
    row('2026-07', '31599', 1000, 20),
  ]
  const { series } = buildPtPenetration(rows, opts())
  const springfield = series.find(s => s.name === 'Springfield').points
  assert.equal(springfield.find(p => p.month === '2026-06').value, null)
  assert.equal(springfield.find(p => p.month === '2026-07').value, 2)
  // The open club is unaffected.
  assert.equal(series.find(s => s.name === 'Keizer').points.find(p => p.month === '2026-06').value, 2)
})

test('totals pool every club before taking the rate', () => {
  // Rate of the whole, not the average of the club rates: 60/4000 = 1.5%,
  // where averaging 3% and 1% would give 2%.
  const rows = [
    row('2026-07', '31598', 1000, 30),
    row('2026-07', '31599', 3000, 30),
  ]
  const { totals, summary } = buildPtPenetration(rows, opts())
  assert.equal(totals[0].members, 4000)
  assert.equal(totals[0].ptMembers, 60)
  assert.equal(totals[0].penetration, 1.5)
  assert.equal(summary.penetration, 1.5)
})

test('metrics switch what the line plots', () => {
  // 25 PT members: 20 on a recurring service, 8 on a prepaid package, 3 with
  // both — so the parts exceed the whole and must not be summed.
  const rows = [row('2026-07', '31598', 1000, 25, 20, 8)]
  assert.equal(buildPtPenetration(rows, opts({ metric: 'penetration' })).series[0].points[0].value, 2.5)
  assert.equal(buildPtPenetration(rows, opts({ metric: 'recurringPenetration' })).series[0].points[0].value, 2)
  assert.equal(buildPtPenetration(rows, opts({ metric: 'pifPenetration' })).series[0].points[0].value, 0.8)
  assert.equal(buildPtPenetration(rows, opts({ metric: 'ptMembers' })).series[0].points[0].value, 25)
  // An unknown metric falls back rather than throwing.
  assert.equal(buildPtPenetration(rows, opts({ metric: 'nope' })).metric, 'penetration')
})

test('a member holding both a recurring service and a package is counted once', () => {
  const rows = [row('2026-07', '31598', 1000, 25, 20, 8)]
  const { summary } = buildPtPenetration(rows, opts())
  assert.equal(summary.ptMembers, 25)
  assert.equal(summary.recurring, 20)
  assert.equal(summary.pif, 8)
  // 20 + 8 = 28 people would be double-counting the 3 who hold both.
  assert.ok(summary.recurring + summary.pif > summary.ptMembers)
})

test('a month with no PT members reports 0%, not null', () => {
  // Distinct from a club with no members at all, which has no rate.
  const rows = [row('2026-06', '31598', 1000, 5), row('2026-07', '31598', 1000, 0)]
  const { series } = buildPtPenetration(rows, opts())
  assert.equal(series[0].points.find(p => p.month === '2026-07').value, 0)
})

test('the year-ago comparison is flagged when there is nothing to compare', () => {
  const rows = [row('2026-06', '31598', 1000, 20), row('2026-07', '31598', 1000, 30)]
  const { summary } = buildPtPenetration(rows, opts())
  assert.equal(summary.hasPriorYear, false)
  assert.equal(summary.vsPriorYear, null)
  // Month over month still works.
  assert.equal(summary.vsPriorMonth, 50)
})

test('a full year back compares against the same month', () => {
  const rows = []
  for (let i = 0; i <= 12; i++) {
    const m = shiftMonth('2026-07', -i)
    rows.push(row(m, '31598', 1000, i === 0 ? 30 : 20))
  }
  const { summary } = buildPtPenetration(rows, opts())
  assert.equal(summary.hasPriorYear, true)
  assert.equal(summary.vsPriorYear, 50) // 3% against 2%
})

test('empty input does not throw', () => {
  const out = buildPtPenetration([], opts())
  assert.deepEqual(out.series, [])
  assert.equal(out.summary, null)
})

test('leading months with no PT data are dropped, not drawn as 0%', () => {
  // Training revenue starts later than the member history; those months are
  // unmeasurable, not zero, and plotting them draws a cliff at the left edge.
  const rows = [
    row('2023-12', '31598', 1000, 0),
    row('2024-01', '31598', 1000, 0),
    row('2024-02', '31598', 1000, 20),
    row('2024-03', '31598', 1000, 0),   // a real zero, mid-series
    row('2024-04', '31598', 1000, 25),
  ]
  const { months, trimmedLeadingMonths, series } = buildPtPenetration(rows, opts())
  assert.deepEqual(months, ['2024-02', '2024-03', '2024-04'])
  assert.equal(trimmedLeadingMonths, 2)
  // The genuine zero survives.
  assert.equal(series[0].points.find(p => p.month === '2024-03').value, 0)
})

test('a series that never had PT data is left intact rather than emptied', () => {
  const rows = [row('2026-06', '31598', 1000, 0), row('2026-07', '31598', 1000, 0)]
  const { months, trimmedLeadingMonths } = buildPtPenetration(rows, opts())
  assert.equal(months.length, 2)
  assert.equal(trimmedLeadingMonths, 0)
})
