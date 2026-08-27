const test = require('node:test')
const assert = require('node:assert')

const { rankSegments, foldSegment, OTHER_LABEL, MAX_SERIES } = require('./analyticsSegments')
const { buildMembershipTrends } = require('./membershipTrends')
const { buildNetMembership, sortRows } = require('./netMembership')
const { buildRevenueByProfitCenter } = require('./revenueByProfitCenter')
const { buildRevenueTrends } = require('./revenueTrends')
const { buildFirstPtPurchase, BUCKETS } = require('./firstPtPurchase')

// ---------------------------------------------------------------------------
// analyticsSegments
// ---------------------------------------------------------------------------

test('rankSegments keeps the biggest and names what it pooled', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ s: `s${i}`, v: 100 - i }))
  const { keep, other } = rankSegments(rows, 's', 'v')
  assert.equal(keep.size, MAX_SERIES)
  assert.ok(keep.has('s0'))
  assert.equal(other.length, 12 - MAX_SERIES)
  // The report has to be able to SAY what went into Other, not just show a bar.
  assert.ok(other.includes('s11'))
})

test('rankSegments ranks by magnitude, so a big negative is not hidden', () => {
  // Refunds are a real profit centre with a large negative total. Ranked by
  // raw value it would sort last and be folded away behind trivia.
  const rows = [
    { s: 'refunds', v: -50000 },
    ...Array.from({ length: 9 }, (_, i) => ({ s: `tiny${i}`, v: 10 })),
  ]
  const { keep } = rankSegments(rows, 's', 'v')
  assert.ok(keep.has('refunds'))
})

test('foldSegment sends unknown and missing values to Other', () => {
  const keep = new Set(['a'])
  assert.equal(foldSegment('a', keep), 'a')
  assert.equal(foldSegment('b', keep), OTHER_LABEL)
  assert.equal(foldSegment(null, keep), OTHER_LABEL)
})

// ---------------------------------------------------------------------------
// Membership Trends
// ---------------------------------------------------------------------------

const trendRows = [
  { month_start: '2025-07-01', segment: 'A', total_members: 100, new_members: 10 },
  { month_start: '2025-08-01', segment: 'A', total_members: 110, new_members: 12 },
  { month_start: '2026-07-01', segment: 'A', total_members: 130, new_members: 20 },
  { month_start: '2026-08-01', segment: 'A', total_members: 140, new_members: 22 },
]

test('membership trends treats total members as a level, not a flow', () => {
  const out = buildMembershipTrends(trendRows, { asOf: '2026-08-26' })
  const total = out.tiles.find(t => t.key === 'totalMembers')
  // The latest month, NOT 130 + 140 — summing counts a member once per month.
  assert.equal(total.value, 140)
  const newYtd = out.tiles.find(t => t.key === 'newMembers')
  // New members IS a flow and is summed across the year to date.
  assert.equal(newYtd.value, 42)
})

test('membership trends compares like spans of the year', () => {
  const out = buildMembershipTrends(trendRows, { asOf: '2026-08-26' })
  // Prior year to the SAME month, so eight months is never set against twelve.
  assert.equal(out.tiles.find(t => t.key === 'totalMembersPrior').value, 110)
  assert.equal(out.tiles.find(t => t.key === 'newMembersPrior').value, 22)
  assert.equal(out.tiles.find(t => t.key === 'newMembersYoy').value, 90.9)
})

test('membership trends squares every series against every month', () => {
  const sparse = [
    { month_start: '2026-07-01', segment: 'A', total_members: 10, new_members: 1 },
    { month_start: '2026-08-01', segment: 'B', total_members: 20, new_members: 2 },
  ]
  const out = buildMembershipTrends(sparse, { asOf: '2026-08-26' })
  for (const s of out.series) {
    assert.equal(s.points.length, out.months.length,
      'a series missing a month would draw a line straight through it')
  }
})

test('membership trends folds the tail into one Other line', () => {
  const rows = []
  for (let i = 0; i < 12; i++) {
    rows.push({ month_start: '2026-08-01', segment: `s${i}`, total_members: 100 - i, new_members: 1 })
  }
  const out = buildMembershipTrends(rows, { asOf: '2026-08-26' })
  assert.equal(out.series.length, MAX_SERIES + 1)
  const other = out.series.find(s => s.key === OTHER_LABEL)
  assert.ok(other)
  // Other is the SUM of the folded segments, not one of them.
  assert.equal(other.points[0].totalMembers, 92 + 91 + 90 + 89)
  // And it sorts last so it never takes a lead colour.
  assert.equal(out.series[out.series.length - 1].key, OTHER_LABEL)
})

// ---------------------------------------------------------------------------
// Net Membership
// ---------------------------------------------------------------------------

const netRows = [
  { segment: 'X', new_members: 100, lost_members: 40, prior_new: 90, prior_lost: 50 },
  { segment: 'Y', new_members: 30, lost_members: 80, prior_new: 40, prior_lost: 20 },
]

test('net membership computes net and its prior year', () => {
  const out = buildNetMembership(netRows)
  const x = out.rows.find(r => r.key === 'X')
  assert.equal(x.net, 60)
  assert.equal(x.priorNet, 40)
  assert.equal(out.tiles.find(t => t.key === 'net').value, 10)
  assert.equal(out.tiles.find(t => t.key === 'priorNet').value, 60)
})

test('net membership shares one bar scale across new and lost', () => {
  const out = buildNetMembership(netRows)
  // 100 is the largest of ALL four counts; measuring the two halves of a pair
  // on different rulers would make a smaller loss look bigger than a larger gain.
  assert.equal(out.maxBar, 100)
})

test('net membership ranks on gross activity, not net', () => {
  // A club that signed 800 and lost 800 nets zero but is the busiest in the
  // estate; ranking on net would fold it into Other.
  const rows = [
    { segment: 'churner', new_members: 800, lost_members: 800, prior_new: 0, prior_lost: 0 },
    ...Array.from({ length: 9 }, (_, i) => ({
      segment: `q${i}`, new_members: 5, lost_members: 0, prior_new: 0, prior_lost: 0,
    })),
  ]
  const out = buildNetMembership(rows)
  assert.ok(out.rows.some(r => r.key === 'churner'))
})

test('net membership sorts and always leaves Other last', () => {
  const rows = [
    { segment: 'a', new_members: 1, lost_members: 0, prior_new: 0, prior_lost: 0 },
    { segment: 'b', new_members: 9, lost_members: 0, prior_new: 0, prior_lost: 0 },
  ]
  assert.equal(sortRows(buildNetMembership(rows).rows, 'net_asc')[0].key, 'a')
  assert.equal(sortRows(buildNetMembership(rows).rows, 'net_desc')[0].key, 'b')
})

// ---------------------------------------------------------------------------
// Revenue by Profit Center
// ---------------------------------------------------------------------------

const pcRows = [
  { view_key: 'C1', group_name: 'Dues', sort_order: 10, revenue: 1000 },
  { view_key: 'C1', group_name: 'Training', sort_order: 20, revenue: 400 },
  { view_key: 'C2', group_name: 'Dues', sort_order: 10, revenue: 600 },
  { view_key: 'C2', group_name: 'Other', sort_order: 999, revenue: 50 },
]

test('revenue by profit center orders groups by definition, not size', () => {
  const out = buildRevenueByProfitCenter(pcRows)
  // Dues before Training before Other, every bar, every reload — a stack that
  // reordered itself per club would repaint the colours as the mix shifted.
  assert.deepEqual(out.groups, ['Dues', 'Training', 'Other'])
})

test('revenue by profit center gives every row every group', () => {
  const out = buildRevenueByProfitCenter(pcRows)
  for (const row of out.rows) {
    for (const g of out.groups) {
      assert.equal(typeof row.values[g], 'number',
        'a missing group would shift the segments above it along the bar')
    }
  }
  assert.equal(out.rows.find(r => r.key === 'C1').values.Other, 0)
})

test('revenue by profit center totals reconcile', () => {
  const out = buildRevenueByProfitCenter(pcRows)
  assert.equal(out.grandTotal, 2050)
  assert.equal(out.rows.find(r => r.key === 'C1').total, 1400)
  assert.equal(out.maxTotal, 1400)
})

test('revenue by profit center never calls Other the largest group', () => {
  // Other is a pool, not a business line; naming it the winner would be noise.
  const out = buildRevenueByProfitCenter([
    { view_key: 'C', group_name: 'Other', sort_order: 999, revenue: 99999 },
    { view_key: 'C', group_name: 'Dues', sort_order: 10, revenue: 5 },
  ])
  assert.equal(out.tiles.find(t => t.key === 'top').value, 'Dues')
})

// ---------------------------------------------------------------------------
// Revenue Trends
// ---------------------------------------------------------------------------

const rtRows = [
  { grain: 'monthly', bucket: '2026-07-01', segment: 'A', revenue: 700 },
  { grain: 'monthly', bucket: '2026-08-01', segment: 'A', revenue: 500 },
  { grain: 'daily', bucket: '2026-08-25', segment: 'A', revenue: 25 },
]

test('revenue trends gives each grain its own panel and scale', () => {
  const out = buildRevenueTrends(rtRows)
  // Monthly first, then daily. Annual was dropped in migration 143.
  assert.deepEqual(out.panels.map(p => p.key), ['monthly', 'daily'])
  // Per-panel maxima. One shared scale would flatten the daily line to a smear
  // against a month's revenue, which is the dual-axis mistake in another costume.
  assert.equal(out.panels.find(p => p.key === 'monthly').max, 700)
  assert.equal(out.panels.find(p => p.key === 'daily').max, 25)
})

test('revenue trends ignores an annual grain if one ever arrives', () => {
  // The SQL no longer emits it; a stale cache or an older function must not
  // reintroduce it as a third panel.
  const out = buildRevenueTrends([...rtRows, { grain: 'annual', bucket: '2026-01-01', segment: 'A', revenue: 1200 }])
  assert.deepEqual(out.panels.map(p => p.key), ['monthly', 'daily'])
})

test('revenue trends drops a grain with no data rather than drawing an empty axis', () => {
  const out = buildRevenueTrends(rtRows.filter(r => r.grain !== 'daily'))
  assert.deepEqual(out.panels.map(p => p.key), ['monthly'])
})

test('a single-bucket panel still carries its data', () => {
  // Migration 143 means monthly no longer collapses to one bucket on the
  // default range, but a one-day daily panel still can. The component draws
  // that as a bar, because a polyline through one point renders nothing at all.
  const out = buildRevenueTrends([{ grain: 'daily', bucket: '2026-08-26', segment: 'Overall', revenue: 30000 }])
  const daily = out.panels.find(p => p.key === 'daily')
  assert.equal(daily.buckets.length, 1)
  assert.equal(daily.totals[0].revenue, 30000)
  assert.equal(daily.max, 30000)
})

test('segments returned are the SERIES drawn, not the segment types', () => {
  // The route once overwrote this with the dropdown's list of segment types, so
  // the legend read "Overall, Club, Dues vs Discretionary, ..." in colours that
  // matched no line, and never hid itself because that list is always long.
  // The names here must be the values being plotted.
  const out = buildRevenueTrends([
    { grain: 'monthly', bucket: '2026-08-01', segment: 'Salem', revenue: 10 },
    { grain: 'monthly', bucket: '2026-08-01', segment: 'Keizer', revenue: 20 },
  ])
  assert.deepEqual(out.segments.map(s => s.key).sort(), ['Keizer', 'Salem'])
})

test('a single series yields one legend entry, so the chart can drop the key', () => {
  // Overall is one line; the component hides the legend below two entries.
  const out = buildRevenueTrends([
    { grain: 'monthly', bucket: '2026-07-01', segment: 'Overall', revenue: 10 },
    { grain: 'monthly', bucket: '2026-08-01', segment: 'Overall', revenue: 20 },
  ])
  assert.equal(out.segments.length, 1)
  assert.equal(out.segments[0].key, 'Overall')
})

test('month-to-date buckets are comparable, so the newest is not a false collapse', () => {
  // What migration 143 exists for. Each month is cut at the same day, so the
  // current month sits beside like-for-like history instead of beside whole
  // 31-day months. These are the real figures for a 26 August anchor.
  const out = buildRevenueTrends([
    { grain: 'monthly', bucket: '2026-06-01', segment: 'Overall', revenue: 809265 },
    { grain: 'monthly', bucket: '2026-07-01', segment: 'Overall', revenue: 746160 },
    { grain: 'monthly', bucket: '2026-08-01', segment: 'Overall', revenue: 739952 },
  ])
  const monthly = out.panels.find(p => p.key === 'monthly')
  assert.equal(monthly.buckets.length, 3)
  // August is within 1% of July, not the 18% drop that comparing 26 days
  // against a whole 31-day July ($904,228) would have shown.
  const [, jul, aug] = monthly.totals.map(t => t.revenue)
  assert.ok(Math.abs(aug - jul) / jul < 0.02, `aug ${aug} vs jul ${jul}`)
})

test('revenue trends ranks once so a segment is named in every panel', () => {
  const rows = []
  for (let i = 0; i < 11; i++) {
    rows.push({ grain: 'monthly', bucket: '2026-08-01', segment: `s${i}`, revenue: 100 - i })
    // In the daily panel the ranking is reversed; if each panel ranked itself,
    // s10 would be named there and pooled in monthly, which reads as a bug.
    rows.push({ grain: 'daily', bucket: '2026-08-25', segment: `s${i}`, revenue: i })
  }
  const out = buildRevenueTrends(rows)
  const names = p => out.panels.find(x => x.key === p).series.map(s => s.key).sort()
  assert.deepEqual(names('daily'), names('monthly'))
})

// ---------------------------------------------------------------------------
// First Purchases by Join Month
// ---------------------------------------------------------------------------

function fpRows(segment, counts, members) {
  return BUCKETS.map((bucket, i) => ({
    segment, bucket, bucket_order: i + 1,
    purchasers: counts[i],
    segment_members: members,
    segment_purchasers: counts.reduce((a, b) => a + b, 0),
  }))
}

test('first purchases separates % of purchases from % of members', () => {
  const rows = [...fpRows('A', [50, 30, 10, 5, 3, 2], 1000)]
  const out = buildFirstPtPurchase(rows)
  // The chart is a share of BUYERS and sums to 100.
  const sum = out.overall.reduce((s, b) => s + b.pct, 0)
  assert.ok(Math.abs(sum - 100) < 0.2, `overall bars summed to ${sum}`)
  assert.equal(out.overall[0].pct, 50)
  // The tile is a share of MEMBERS and is much smaller.
  assert.equal(out.tiles.find(t => t.key === 'purchased').value, 100)
  assert.equal(out.tiles.find(t => t.key === 'notPurchased').value, 900)
  assert.equal(out.tiles.find(t => t.key === 'pctPurchased').value, 10)
})

test('first purchases takes cohort size once, not once per bucket', () => {
  // segment_members is repeated on all six rows; summing it would report six
  // times the membership and divide the purchase rate by six.
  const out = buildFirstPtPurchase(fpRows('A', [1, 0, 0, 0, 0, 0], 600))
  assert.equal(out.bySegment[0].members, 600)
  assert.equal(out.bySegment[0].purchaseRate, 0.2)
})

test('first purchases scales each segment against its own buyers', () => {
  const rows = [...fpRows('Big', [90, 10, 0, 0, 0, 0], 5000), ...fpRows('Small', [9, 1, 0, 0, 0, 0], 100)]
  const out = buildFirstPtPurchase(rows)
  const big = out.bySegment.find(s => s.key === 'Big')
  const small = out.bySegment.find(s => s.key === 'Small')
  // Same shape despite a 10x size difference — otherwise every segment chart is
  // just a picture of segment size.
  assert.equal(big.buckets[0].pct, 90)
  assert.equal(small.buckets[0].pct, 90)
})

test('first purchases returns every bucket even when nobody landed in one', () => {
  const out = buildFirstPtPurchase(fpRows('A', [5, 0, 0, 0, 0, 0], 100))
  assert.equal(out.overall.length, BUCKETS.length)
  assert.deepEqual(out.overall.map(b => b.bucket), BUCKETS)
  assert.equal(out.overall[1].purchasers, 0)
})

test('first purchases reports no rate rather than zero when nobody bought', () => {
  const out = buildFirstPtPurchase(fpRows('A', [0, 0, 0, 0, 0, 0], 100))
  // A bucket share of "0%" would claim we measured a distribution; there isn't one.
  assert.equal(out.overall[0].pct, null)
  assert.equal(out.tiles.find(t => t.key === 'pctPurchased').value, 0)
})

test('every builder survives empty input', () => {
  assert.doesNotThrow(() => buildMembershipTrends([], { asOf: '2026-08-26' }))
  assert.doesNotThrow(() => buildNetMembership([]))
  assert.doesNotThrow(() => buildRevenueByProfitCenter([]))
  assert.doesNotThrow(() => buildRevenueTrends([]))
  assert.doesNotThrow(() => buildFirstPtPurchase([]))
  assert.doesNotThrow(() => buildMembershipTrends(null, { asOf: '2026-08-26' }))
  assert.doesNotThrow(() => buildFirstPtPurchase(null))
})
