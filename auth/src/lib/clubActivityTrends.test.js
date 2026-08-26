const test = require('node:test')
const assert = require('node:assert')
const { buildTrends, deriveMonth, pctChange, aggregate } = require('./clubActivityTrends')

function row(month, over = {}) {
  return {
    month_start: month + '-01',
    total_members: 1000,
    new_member_units: 100,
    lost_members: 40,
    total_checkins: 5000,
    unique_checkins: 4900,
    total_revenue: 50000,
    pt_revenue: 10000,
    has_checkin_data: true,
    ...over,
  }
}

// 25 months ending 2026-07: 13 shown, 12 as comparison partners.
function fullSeries(over = () => ({})) {
  const out = []
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      if (key < '2025-07' || key > '2026-07') continue
      out.push(row(key, over(key)))
    }
  }
  return out
}

test('pctChange guards a zero and a missing base', () => {
  assert.equal(pctChange(110, 100), 10)
  assert.equal(pctChange(90, 100), -10)
  assert.equal(pctChange(100, 0), null)
  assert.equal(pctChange(100, null), null)
  // A negative base compares by magnitude, so improving -100 to -50 reads +50%
  // rather than -50%.
  assert.equal(pctChange(-50, -100), 50)
})

test('aggregate picks the right summary per tile kind', () => {
  assert.equal(aggregate('sum', [1, 2, 3]), 6)
  assert.equal(aggregate('mean', [2, 4]), 3)
  // A level is the latest reading, not the total of every reading.
  assert.equal(aggregate('point', [10, 20, 30]), 30)
  assert.equal(aggregate('sum', [null, null]), null)
  // Nulls are skipped rather than counted as zero.
  assert.equal(aggregate('mean', [null, 4, null, 6]), 5)
  assert.equal(aggregate('point', [10, null]), 10)
})

test('derives net members and the three ratios', () => {
  const m = deriveMonth(row('2026-07', { new_member_units: 100, lost_members: 40, total_members: 1000, total_checkins: 4000, total_revenue: 20000 }))
  assert.equal(m.netMembers, 60)
  assert.equal(m.avgCheckinsPerMember, 4)
  assert.equal(m.avgRevenuePerMember, 20)
  assert.equal(m.avgRevenuePerVisit, 5)
})

test('months before check-in collection report null, not zero', () => {
  // A zero would read as "nobody came in" rather than "we were not collecting".
  const m = deriveMonth(row('2025-01', { has_checkin_data: false, total_checkins: 0, unique_checkins: 0 }))
  assert.equal(m.uniqueCheckins, null)
  assert.equal(m.avgCheckinsPerMember, null)
  assert.equal(m.avgRevenuePerVisit, null)
  // Non-check-in metrics are unaffected.
  assert.equal(m.totalMembers, 1000)
  assert.equal(m.avgRevenuePerMember, 50)
})

test('a month is compared against the same month a year earlier', () => {
  const rows = fullSeries(key => (key === '2026-07' ? { new_member_units: 150 } : {}))
  const { tiles } = buildTrends(rows, 13)
  const newUnits = tiles.find(t => t.key === 'newMemberUnits')
  const july = newUnits.series.find(p => p.month === '2026-07')
  assert.equal(july.value, 150)
  // Against July 2025, not June 2026.
  assert.equal(july.priorValue, 100)
  assert.equal(july.changePct, 50)
})

test('a gap in the series does not shift the comparison', () => {
  // Drop 2025-09 entirely. 2026-09 is not in the shown window, but the pairing
  // for every other month must survive the hole.
  const rows = fullSeries().filter(r => !String(r.month_start).startsWith('2025-09'))
  const { tiles } = buildTrends(rows, 13)
  const newUnits = tiles.find(t => t.key === 'newMemberUnits')
  const oct = newUnits.series.find(p => p.month === '2025-10')
  assert.equal(oct.priorValue, null) // 2024-10 is outside the fetched range
  const july = newUnits.series.find(p => p.month === '2026-07')
  assert.equal(july.priorValue, 100) // still paired with 2025-07
})

test('total members is a level: YTD is the latest month, not a sum', () => {
  const rows = fullSeries(key => ({ total_members: key === '2026-07' ? 19683 : 1000 }))
  const { tiles } = buildTrends(rows, 13)
  const total = tiles.find(t => t.key === 'totalMembers')
  assert.equal(total.ytd, 19683)
})

test('new member units is a flow: YTD sums the calendar year to date', () => {
  const rows = fullSeries()
  const { tiles } = buildTrends(rows, 13)
  const newUnits = tiles.find(t => t.key === 'newMemberUnits')
  // Jan through Jul 2026 only — 2025 months are excluded from YTD.
  assert.equal(newUnits.ytd, 700)
  // Only July 2026 has a partner in this fixture (July 2025), so the YoY
  // compares that one month on both sides rather than seven months against
  // one, which would have read +600%.
  assert.equal(newUnits.ytdPrior, 100)
  assert.equal(newUnits.comparedMonths, 1)
  assert.equal(newUnits.yoyPct, 0)
})

test('year-over-year never compares a full year against a partial one', () => {
  // 25 months: every YTD month has a real partner.
  const rows = []
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      if (key < '2025-07' || key > '2026-07') {
        if (key < '2024-07' || key > '2026-07') continue
      }
      rows.push(row(key, { new_member_units: y === 2026 ? 120 : 100 }))
    }
  }
  const { tiles } = buildTrends(rows, 13)
  const newUnits = tiles.find(t => t.key === 'newMemberUnits')
  assert.equal(newUnits.comparedMonths, 7)
  assert.equal(newUnits.ytd, 840)      // 7 x 120
  assert.equal(newUnits.ytdPrior, 700) // 7 x 100
  assert.equal(newUnits.yoyPct, 20)
})

test('ratio tiles average the monthly rate rather than summing it', () => {
  const rows = fullSeries()
  const { tiles } = buildTrends(rows, 13)
  const avg = tiles.find(t => t.key === 'avgCheckinsPerMember')
  assert.equal(avg.ytd, 5) // 5000 checkins / 1000 members, every month
})

test('a tile with no prior-year data is flagged rather than drawn empty', () => {
  const rows = fullSeries().map(r => ({ ...r, has_checkin_data: String(r.month_start) >= '2026-01-01' }))
  const { tiles, checkinGapMonths } = buildTrends(rows, 13)
  const checkins = tiles.find(t => t.key === 'uniqueCheckins')
  assert.equal(checkins.missingPriorYear, true)
  assert.equal(checkins.yoyPct, null)
  assert.ok(checkinGapMonths.includes('2025-07'))
  // Revenue still compares fine — the gap is check-ins only.
  assert.equal(tiles.find(t => t.key === 'totalRevenue').missingPriorYear, false)
})

test('the shown window is the tail, and asOf is its last month', () => {
  const { months, asOfMonth } = buildTrends(fullSeries(), 13)
  assert.equal(months.length, 13)
  assert.equal(months[0], '2025-07')
  assert.equal(asOfMonth, '2026-07')
})

test('empty input does not throw', () => {
  const out = buildTrends([], 13)
  assert.equal(out.asOfMonth, null)
  assert.equal(out.tiles.length, 10)
  assert.equal(out.tiles[0].ytd, null)
})
