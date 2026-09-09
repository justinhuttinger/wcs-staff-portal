const test = require('node:test')
const assert = require('node:assert')
const { buildPtSnapshot, shapeBreakdowns, seriesRow: ptSeriesRow } = require('./ptSnapshot')
const { buildClubSnapshot, seriesRow: memSeriesRow } = require('./clubSnapshot')

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

// The training half, shaped as analytics_pt_snapshot returns it.
const ptWindow = (over = {}) => ({
  day_ones: 317, day_ones_completed: 126, day_ones_no_show: 38,
  day_ones_cancelled: 44, day_ones_scheduled: 109, day_ones_sold: 47,
  new_value: 51781, lost_value: 23618,
  ...over,
})

test('a club that lost more than it gained shows a negative net', () => {
  const out = buildClubSnapshot(
    { window: memWindow(), summary: memSummary, pt: ptWindow() }, null, []
  )
  // August 2026 really was negative; a report that cannot say so is useless.
  assert.equal(out.stats.find(s => s.key === 'netMembers').value, -34)
})

test('no second number labelled new members', () => {
  const out = buildClubSnapshot(
    { window: memWindow(), summary: { ...memSummary, newMemberUnits: 999 } }, null, []
  )
  const labels = out.stats.map(s => s.label)
  // buildReport counts new members its own way. Two near-but-unequal figures
  // both labelled "new members" is how a reader loses faith in the whole card.
  assert.equal(labels.filter(l => /joined|new member/i.test(l)).length, 1)
  assert.equal(out.totals.newMembers, 529)
})

test('an absent check-in feed is absent, not zero', () => {
  const out = buildClubSnapshot(
    { window: memWindow({ checkins: 0, has_checkin_data: false }), summary: memSummary },
    null, []
  )
  // Check-in coverage has been wrong before. A zero would read as "nobody came
  // to the gym", which is a very different claim from "we have no data".
  assert.equal(out.stats.find(s => s.key === 'checkins').value, null)
})

test('tours and VIPs are null where nothing is recorded, real where it is', () => {
  const out = buildClubSnapshot(
    { window: memWindow(), summary: memSummary }, null, []
  )
  // buildReport reports null for a club that records neither, and the card has
  // to pass that through: a zero would read as "none given" rather than "not
  // being recorded", and for VIPs it would blame staff for a GHL field that
  // was never configured.
  assert.equal(out.stats.find(s => s.key === 'toursGiven').value, null)
  assert.equal(out.stats.find(s => s.key === 'vipCount').value, null)

  const live = buildClubSnapshot(
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
  const out = buildClubSnapshot({ window: memWindow(), summary: memSummary }, null, [])
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


test('the training half uses PT Snapshot definitions exactly', () => {
  const out = buildClubSnapshot({ window: memWindow(), summary: memSummary, pt: ptWindow() }, null, [])
  const at = k => out.stats.find(s => s.key === k).value

  // Show rate excludes the 109 still scheduled: a Day One in the future has not
  // failed to happen yet, and counting it would make the rate sag as a month
  // fills up. 126 of the 208 that were meant to happen.
  assert.equal(at('dayOneShowRate'), 60.6)
  // Close rate is over the ones that actually happened, not all bookings.
  assert.equal(at('dayOneCloseRate'), 37.3)
  assert.equal(at('newPtRevenue'), 51781)
  assert.equal(at('lostPtRevenue'), 23618)
  assert.equal(at('netPtRevenue'), 51781 - 23618)
})

test('PT sold and PT collected are never the same stat', () => {
  const out = buildClubSnapshot({ window: memWindow(), summary: memSummary, pt: ptWindow() }, null, [])
  const labels = out.stats.map(s => s.label)
  // One is money through the till, the other the value of contracts written.
  // Two stats both called "PT Revenue" would be read as a discrepancy.
  assert.equal(labels.filter(l => l === 'PT Revenue').length, 0)
  assert.ok(labels.includes('PT Revenue Collected'))
  assert.ok(labels.includes('New PT Revenue'))
})

test('average days from tour to sale is surfaced and lower is better', () => {
  const out = buildClubSnapshot(
    { window: memWindow(), summary: { ...memSummary, avgDaysToConversion: 2.4 }, pt: ptWindow() },
    null, []
  )
  const stat = out.stats.find(s => s.key === 'avgDaysToConversion')
  assert.equal(stat.value, 2.4)
  // Sitting on the decision longer is worse, so the arrow must not be green.
  assert.equal(stat.betterWhen, 'down')
})

test('a window with no PT activity still builds', () => {
  assert.doesNotThrow(() => buildClubSnapshot({ window: memWindow(), summary: memSummary }, null, []))
  const out = buildClubSnapshot({ window: memWindow(), summary: memSummary }, null, [])
  assert.equal(out.stats.find(s => s.key === 'dayOneShowRate').value, null)
  assert.equal(out.stats.find(s => s.key === 'newPtRevenue').value, 0)
})

test('the series carries both halves, losses positive', () => {
  const row = memSeriesRow({
    month_start: '2026-07-01', total_members: 17088, new_members: 703,
    lost_members: 537, new_dues: 1, revenue: 2, pt_revenue: 3,
    checkins: 4, has_checkin_data: true,
    day_ones: 317, day_ones_completed: 126, day_ones_sold: 47,
    new_value: 51781, lost_value: 23618,
  })
  assert.equal(row.dayOnes, 317)
  assert.equal(row.dayOneCloseRate, 37.3)
  // Positive, or TrendPanel draws it below its own plot area and it vanishes.
  assert.equal(row.lostPtRevenue, 23618)
  assert.equal(row.netPtRevenue, 51781 - 23618)
})

test('the two Day One counts are labelled apart', () => {
  const out = buildClubSnapshot({ window: memWindow(), summary: memSummary, pt: ptWindow() }, null, [])
  const labels = out.stats.map(s => s.label)

  // They count different cohorts on different date fields: one is bookings
  // taken in the window, the other is appointments dated in it. For August 2026
  // that was 274 against 287. Two stats a reader cannot tell apart read as one
  // number contradicting itself.
  assert.ok(labels.includes('Day Ones Booked'))
  assert.ok(labels.includes('Day Ones on Calendar'))
  assert.equal(new Set(labels).size, labels.length, 'every stat label must be unique')

  // 'Scheduled' is a Day One STATUS meaning still-upcoming, so it must not also
  // name the whole cohort.
  assert.ok(!labels.some(l => /Day Ones Scheduled/.test(l)))
})

// ---------------------------------------------------------------------------
// Avg Daily Check-ins.
//
// Sits beside Check-ins because the total is not comparable across windows:
// priorMonthWindow clamps the day to the shorter month, so March against
// February is 31 days against 28. That is a 10% handicap with nothing to do
// with how busy the club was, and the average removes it.
// ---------------------------------------------------------------------------

const dailyStat = (out) => out.stats.find(s => s.key === 'avgDailyCheckins')

test('avg daily check-ins is the total over the days in the window', () => {
  const out = buildClubSnapshot(
    { window: memWindow({ checkins: 4500 }), summary: memSummary }, null, [],
    { days: 30 }
  )
  assert.equal(dailyStat(out).value, 150)
})

test('it is rounded to one decimal, not to a whole visit', () => {
  const out = buildClubSnapshot(
    { window: memWindow({ checkins: 100 }), summary: memSummary }, null, [], { days: 3 }
  )
  assert.equal(dailyStat(out).value, 33.3)
})

// The point of the stat. Same daily rate, different window lengths: the totals
// look 10% apart and the averages correctly look identical.
test('two windows of different length compare fairly', () => {
  const out = buildClubSnapshot(
    { window: memWindow({ checkins: 3100 }), summary: memSummary },
    { window: memWindow({ checkins: 2800 }), summary: memSummary },
    [], { days: 31, priorDays: 28 }
  )
  const s = dailyStat(out)
  assert.equal(s.value, 100)
  assert.equal(s.prior, 100)
  assert.equal(s.change, 0)
})

// It must not invent traffic the check-in feed never reported.
test('an absent check-in feed gives an absent average, not zero', () => {
  const out = buildClubSnapshot(
    { window: memWindow({ checkins: 0, has_checkin_data: false }), summary: memSummary },
    null, [], { days: 30 }
  )
  assert.equal(dailyStat(out).value, null)
})

test('no day count means no average rather than a divide by zero', () => {
  for (const opts of [{}, { days: 0 }, { days: null }]) {
    const out = buildClubSnapshot(
      { window: memWindow(), summary: memSummary }, null, [], opts
    )
    assert.equal(dailyStat(out).value, null, JSON.stringify(opts))
  }
})

test('it sits immediately after Check-ins', () => {
  const out = buildClubSnapshot(
    { window: memWindow(), summary: memSummary }, null, [], { days: 30 }
  )
  const keys = out.stats.map(s => s.key)
  assert.equal(keys[keys.indexOf('checkins') + 1], 'avgDailyCheckins')
})

// --- Trial Conversion -------------------------------------------------------
// The same number the KPI report scores against its goal, carried onto the
// snapshot card. Counted in lib/trialConversion; injected here.

test('trial conversion is carried onto the card with its prior', () => {
  const out = buildClubSnapshot(
    { window: {}, summary: {} },
    { window: {}, summary: {} },
    [],
    { trial: { started: 20, won: 5, rate: 25 }, priorTrial: { started: 10, won: 4, rate: 40 } },
  )
  const s = out.stats.find(x => x.key === 'trialConversion')
  assert.strictEqual(s.value, 25)
  assert.strictEqual(s.prior, 40)
})

test('no trials in the window reads as no answer, not as 0%', () => {
  // Zero would assert that trials ran and none converted. That is a different
  // and much worse fact than there being none to convert.
  const out = buildClubSnapshot(
    { window: {}, summary: {} },
    { window: {}, summary: {} },
    [],
    { trial: { started: 0, won: 0, rate: null }, priorTrial: null },
  )
  const s = out.stats.find(x => x.key === 'trialConversion')
  assert.strictEqual(s.value, null)
  assert.strictEqual(s.prior, null)
})

test('an unreachable GHL does not take the rest of the card down', () => {
  // The route catches a failed trial count into null. Every other stat must
  // still be there.
  const out = buildClubSnapshot(
    { window: { new_members: 7 }, summary: {} },
    { window: {}, summary: {} },
    [],
    { trial: null, priorTrial: null },
  )
  assert.strictEqual(out.stats.find(x => x.key === 'trialConversion').value, null)
  assert.strictEqual(out.stats.find(x => x.key === 'newMembers').value, 7)
})


// --- stat grouping ----------------------------------------------------------
// Cosmetic on the page, load-bearing here: a stat with no group must still
// reach the client, or a number disappears the day somebody adds one.

test('every stat declares a group the payload also declares', () => {
  const out = buildClubSnapshot({ window: {}, summary: {} }, null, [])
  const declared = new Set(out.statGroups.map(g => g.key))
  for (const s of out.stats) {
    assert.ok(s.group, `${s.key} has no group`)
    assert.ok(declared.has(s.group), `${s.key} is in undeclared group ${s.group}`)
  }
})

test('the groups are sent with the payload, in order', () => {
  const out = buildClubSnapshot({ window: {}, summary: {} }, null, [])
  assert.deepStrictEqual(
    out.statGroups.map(g => g.key),
    ['membership', 'revenue', 'tours', 'dayone', 'pt', 'activity'],
  )
})
