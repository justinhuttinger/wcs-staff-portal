const test = require('node:test')
const assert = require('node:assert')
const {
  buildRevenuePerMember, quarterMonths, lastNMonths, shiftMonth, meanRate, rate,
} = require('./revenuePerMember')

function row(month, segment, revenue, members) {
  return { month_start: month + '-01', segment, revenue, members }
}

test('shiftMonth crosses year boundaries in both directions', () => {
  assert.equal(shiftMonth('2026-08', -12), '2025-08')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2025-12', 1), '2026-01')
  assert.equal(shiftMonth('2026-03', -3), '2025-12')
})

test('a quarter is its whole months up to the anchor, not the full three', () => {
  // August sits in Q3, so a Q3-to-date is July and August only.
  assert.deepEqual(quarterMonths('2026-08'), ['2026-07', '2026-08'])
  assert.deepEqual(quarterMonths('2026-09'), ['2026-07', '2026-08', '2026-09'])
  assert.deepEqual(quarterMonths('2026-01'), ['2026-01'])
  assert.deepEqual(quarterMonths('2026-06'), ['2026-04', '2026-05', '2026-06'])
})

test('lastNMonths ends on the anchor and runs backwards', () => {
  assert.deepEqual(lastNMonths('2026-03', 4), ['2025-12', '2026-01', '2026-02', '2026-03'])
})

test('rate and meanRate guard an empty membership', () => {
  assert.equal(rate(100, 4), 25)
  assert.equal(rate(100, 0), null)
  const byMonth = new Map([
    ['2026-01', { revenue: 100, members: 10 }],   // 10
    ['2026-02', { revenue: 300, members: 10 }],   // 30
  ])
  assert.equal(meanRate(byMonth, ['2026-01', '2026-02']), 20)
  // A month we hold nothing for is skipped, not counted as a zero rate.
  assert.equal(meanRate(byMonth, ['2026-01', '2026-02', '2026-03']), 20)
  assert.equal(meanRate(byMonth, ['2030-01']), null)
})

test('the period figure averages the monthly rates, not the pooled totals', () => {
  // Jan: 100/10 = 10. Feb: 900/90 = 10. Pooling gives 1000/100 = 10 as well,
  // so use a case where they differ: Jan 100/10 = 10, Feb 900/30 = 30.
  // Mean of rates = 20; pooled would be 1000/40 = 25.
  const rows = [row('2026-01', 'A', 100, 10), row('2026-02', 'A', 900, 30)]
  const { kpis } = buildRevenuePerMember(rows, { months: 24 })
  assert.equal(kpis.currentQuarter, 20)
})

test('totals sum every segment for the month', () => {
  const rows = [
    row('2026-07', 'SINGLE', 600, 20),
    row('2026-07', 'FAMILY', 400, 5),
  ]
  const { totals } = buildRevenuePerMember(rows, { months: 24 })
  const july = totals.find(t => t.month === '2026-07')
  assert.equal(july.revenue, 1000)
  assert.equal(july.members, 25)
  assert.equal(july.revenuePerMember, 40)
})

test('a segment with nobody that month breaks the line instead of dropping to zero', () => {
  const rows = [
    row('2026-06', 'A', 100, 10),
    row('2026-07', 'B', 100, 10),
    row('2026-07', 'A', 200, 10),
    row('2026-08', 'A', 300, 10),
  ]
  const { series } = buildRevenuePerMember(rows, { months: 24 })
  const b = series.find(s => s.name === 'B')
  const june = b.points.find(p => p.month === '2026-06')
  // Absent, not zero — zero would claim B earned nothing per member.
  assert.equal(june.value, null)
  assert.equal(b.points.find(p => p.month === '2026-07').value, 10)
})

test('segments beyond the cap are dropped from the lines and counted', () => {
  const rows = []
  for (let i = 0; i < 10; i++) rows.push(row('2026-07', 'S' + i, 100, (i + 1) * 10))
  const { segments, foldedSegments } = buildRevenuePerMember(rows, { months: 24, maxSegments: 4 })
  assert.equal(segments.length, 4)
  assert.equal(foldedSegments, 6)
  // Ranked by members, so the biggest four survive.
  assert.deepEqual(segments, ['S9', 'S8', 'S7', 'S6'])
})

test('Unknown never takes a line slot', () => {
  const rows = [
    row('2026-07', 'Unknown', 100, 500),
    row('2026-07', 'A', 100, 10),
    row('2026-07', 'B', 100, 5),
  ]
  const { segments } = buildRevenuePerMember(rows, { months: 24, maxSegments: 2 })
  assert.deepEqual(segments, ['A', 'B'])
})

test('a quarter to date is compared against a whole prior quarter', () => {
  const rows = []
  // Q2 2026 complete, Q3 only July and August so far.
  for (const [m, rev] of [['2026-04', 100], ['2026-05', 100], ['2026-06', 100], ['2026-07', 200], ['2026-08', 200]]) {
    rows.push(row(m, 'A', rev, 10))
  }
  const { kpis } = buildRevenuePerMember(rows, { months: 24 })
  assert.deepEqual(kpis.currentQuarterMonths, ['2026-07', '2026-08'])
  assert.equal(kpis.currentQuarter, 20)  // 200/10 both months
  // Against Q2's three whole months at 10 each, not against a truncated Q2.
  assert.equal(kpis.vsPriorQuarter, 100)
})

test('year over year reports how many months actually had a partner', () => {
  const rows = []
  for (let i = 0; i < 6; i++) rows.push(row(shiftMonth('2026-08', -i), 'A', 100, 10))
  const { kpis } = buildRevenuePerMember(rows, { months: 24 })
  // No prior-year months at all in this fixture.
  assert.equal(kpis.comparable12, 0)
  assert.equal(kpis.vsPriorYear12Months, null)
})

test('empty input does not throw', () => {
  const out = buildRevenuePerMember([], {})
  assert.deepEqual(out.totals, [])
  assert.equal(out.anchor, null)
  assert.equal(out.kpis, null)
})
