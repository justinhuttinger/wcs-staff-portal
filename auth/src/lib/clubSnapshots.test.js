const test = require('node:test')
const assert = require('node:assert')
const { buildPtSnapshot, shapeBreakdowns, seriesRow: ptSeriesRow } = require('./ptSnapshot')
const { buildClubMembershipSnapshot, seriesRow: memSeriesRow } = require('./clubMembershipSnapshot')

const ptRow = (over = {}) => ({
  day_ones: 100, day_ones_completed: 60, day_ones_no_show: 20,
  day_ones_cancelled: 10, day_ones_scheduled: 10,
  day_ones_sold: 24, day_ones_no_sale: 36,
  new_sales: 116, new_clients: 94, resigns: 22,
  new_rs_count: 58, new_pif_count: 58,
  new_value: 51781, new_rs_value: 20210, new_pif_value: 31571,
  new_client_value: 40000, resign_value: 11781,
  lost_count: 59, lost_value: 23618,
  ...over,
})

const stat = (out, key) => out.stats.find(s => s.key === key)

test('net is every sale in, every deactivation out', () => {
  const out = buildPtSnapshot(ptRow(), null, [], [])
  // PT Health nets against ALL sales, resigns included, not just new clients.
  assert.equal(stat(out, 'netClients').value, 116 - 59)
  assert.equal(stat(out, 'netValue').value, 51781 - 23618)
})

test('a Day One still in the future has not failed to happen', () => {
  const out = buildPtSnapshot(ptRow(), null, [], [])
  // 60 completed of the 90 that were meant to happen; the 10 still scheduled
  // are excluded, or every show rate would sag as the month filled up.
  assert.equal(stat(out, 'showRate').value, 66.7)
  // Close rate is over the ones that actually happened, not over all bookings.
  assert.equal(stat(out, 'closeRate').value, 40)
})

test('the recurring and paid-in-full split sums to the total', () => {
  const out = buildPtSnapshot(ptRow(), null, [], [])
  assert.equal(out.totals.newRsValue + out.totals.newPifValue, out.totals.newValue)
  assert.equal(out.totals.newRsCount + out.totals.newPifCount, out.totals.newSales)
})

test('losses are positive in the series, because the chart scales from zero', () => {
  const row = ptSeriesRow({
    month_start: '2026-07-01', day_ones: 10, day_ones_completed: 8, day_ones_sold: 3,
    new_sales: 5, new_clients: 4, new_value: 1000, new_rs_value: 400,
    new_pif_value: 600, lost_count: 2, lost_value: 300,
  })
  // A negative point would be drawn below the plot area and simply vanish.
  assert.equal(row.lostValue, 300)
  // The net still carries the sign, because it is read from a stat card.
  assert.equal(row.netValue, 700)
})

test('breakdowns split by kind, sort biggest first, and never go missing', () => {
  const out = shapeBreakdowns([
    { kind: 'no_sale_reason', label: 'Timing or schedule', cnt: 3, value: 0 },
    { kind: 'no_sale_reason', label: 'Cannot afford it right now', cnt: 9, value: 0 },
    { kind: 'sold_type', label: '1 x Week', cnt: 5, value: 0 },
    { kind: 'unknown_kind', label: 'ignored', cnt: 99, value: 0 },
  ])
  assert.deepEqual(out.noSaleReasons.map(r => r.label),
    ['Cannot afford it right now', 'Timing or schedule'])
  // A kind with nothing in it is an empty list, not undefined: the panel has to
  // be able to render its heading and say so.
  assert.deepEqual(out.lostReasons, [])
  assert.equal(out.newTypes.length, 0)
  // An unrecognised kind is dropped rather than crashing the shape.
  assert.ok(!('ignored' in out))
})

test('a comparison against nothing is not a percentage', () => {
  const out = buildPtSnapshot(ptRow(), null, [], [])
  // Number(null) is 0 and finite, so a careless pctChange reports -100% here.
  assert.equal(stat(out, 'newValue').change, null)
  assert.equal(stat(out, 'newValue').prior, null)
})

test('an empty window builds a card rather than throwing', () => {
  assert.doesNotThrow(() => buildPtSnapshot(null, null, null, null))
  const out = buildPtSnapshot(null, null, null, null)
  assert.equal(out.hasActivity, false)
  assert.deepEqual(out.series, [])
  // The loss basis travels with the payload, so the reader is told what is
  // counted without having to open the migration.
  assert.ok(out.lossBasis.includes('Recurring service'))
})

// ---------------------------------------------------------------------------

const memWindow = (over = {}) => ({
  new_members: 529, lost_members: 563, new_dues: 29607,
  revenue: 814068, pt_revenue: 144445, checkins: 45324,
  has_checkin_data: true, total_members: 17049,
  ...over,
})
const memSummary = { pctOnAch: 71.2, avgNewDuesDraft: 55.9, dayOneBookCount: 300, dayOneBookPct: 56.7, bookOnJoinDatePct: 40 }

test('a club that lost more than it gained shows a negative net', () => {
  const out = buildClubMembershipSnapshot(
    { window: memWindow(), summary: memSummary }, null, []
  )
  // August 2026 really was negative; a report that cannot say so is useless.
  assert.equal(out.stats.find(s => s.key === 'netMembers').value, -34)
})

test('no second number labelled new members', () => {
  const out = buildClubMembershipSnapshot(
    { window: memWindow(), summary: { ...memSummary, newMemberUnits: 999 } }, null, []
  )
  const labels = out.stats.map(s => s.label)
  // buildReport counts new members its own way. Two near-but-unequal figures
  // both labelled "new members" is how a reader loses faith in the whole card.
  assert.equal(labels.filter(l => /joined|new member/i.test(l)).length, 1)
  assert.equal(out.totals.newMembers, 529)
})

test('an absent check-in feed is absent, not zero', () => {
  const out = buildClubMembershipSnapshot(
    { window: memWindow({ checkins: 0, has_checkin_data: false }), summary: memSummary },
    null, []
  )
  // Check-in coverage has been wrong before. A zero would read as "nobody came
  // to the gym", which is a very different claim from "we have no data".
  assert.equal(out.stats.find(s => s.key === 'checkins').value, null)
})

test('tours and VIPs are null where nothing is recorded, real where it is', () => {
  const out = buildClubMembershipSnapshot(
    { window: memWindow(), summary: memSummary }, null, []
  )
  // buildReport reports null for a club that records neither, and the card has
  // to pass that through: a zero would read as "none given" rather than "not
  // being recorded", and for VIPs it would blame staff for a GHL field that
  // was never configured.
  assert.equal(out.stats.find(s => s.key === 'toursGiven').value, null)
  assert.equal(out.stats.find(s => s.key === 'vipCount').value, null)

  const live = buildClubMembershipSnapshot(
    { window: memWindow(), summary: {
      ...memSummary, toursGiven: 40, tourConversionRate: 25, vipCount: 120, vipPct: 22.7,
    } }, null, []
  )
  assert.equal(live.stats.find(s => s.key === 'toursGiven').value, 40)
  assert.equal(live.stats.find(s => s.key === 'tourConversionRate').value, 25)
  assert.equal(live.stats.find(s => s.key === 'vipCount').value, 120)
  assert.equal(live.stats.find(s => s.key === 'vipPct').value, 22.7)
})

test('VIP % sits immediately after VIPs collected', () => {
  const out = buildClubMembershipSnapshot({ window: memWindow(), summary: memSummary }, null, [])
  const keys = out.stats.map(s => s.key)
  // The order Justin asked for: VIPs Collected then VIP %.
  assert.equal(keys.indexOf('vipPct'), keys.indexOf('vipCount') + 1)
})

test('members leaving are positive in the series', () => {
  const row = memSeriesRow({
    month_start: '2026-08-01', total_members: 17049, new_members: 529,
    lost_members: 563, new_dues: 1, revenue: 2, pt_revenue: 3,
    checkins: 4, has_checkin_data: true,
  })
  assert.equal(row.lostMembers, 563)
  assert.equal(row.netMembers, -34)
})
