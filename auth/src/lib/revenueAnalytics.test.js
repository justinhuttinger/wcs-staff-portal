const test = require('node:test')
const assert = require('node:assert')
const { buildRevenue, pctChange } = require('./revenueAnalytics')

const row = (category, center, revenue, pos = null, txns = 1) => ({
  category, profit_center: center, headline_position: pos, revenue, txns,
})

test('percentage change is null with no base rather than Infinity', () => {
  assert.equal(pctChange(100, 0), null)
  assert.equal(pctChange(100, null), null)
  assert.equal(pctChange(110, 100), 10)
})

test('a sign flip does not report a percentage', () => {
  // Going from -$500 to $500 is not a 200% improvement, and printing that is
  // worse than printing nothing.
  assert.equal(pctChange(500, -500), null)
  assert.equal(pctChange(-500, 500), null)
})

test('the eight headline categories lead, in their own order', () => {
  const out = buildRevenue(
    [row('Merchandise', 'WCS MERCHANDISE', 100, 8), row('Dues', 'DUES', 900, 1)],
    [], []
  )
  assert.deepEqual(out.headline.map(r => r.category), ['Dues', 'Merchandise'])
})

test('every other centre gets its own row, never an Other bucket', () => {
  // Hiding $289,021 of guest fees behind one row is not a revenue report.
  const out = buildRevenue([
    row('Dues', 'DUES', 900, 1),
    row('Guest Fees', 'GUEST FEES', 289021),
    row('Locker', 'LOCKER', 500),
  ], [], [])

  assert.deepEqual(out.others.map(r => r.category), ['Guest Fees', 'Locker'])
  assert.equal(out.others[0].revenue, 289021)
})

// --- the comparison ---------------------------------------------------------

test('month and year comparisons are both computed', () => {
  const out = buildRevenue(
    [row('Training', 'TRAINING', 144445, 3)],
    [row('Training', 'TRAINING', 129409, 3)],
    [row('Training', 'TRAINING', 98744, 3)],
  )
  const t = out.headline[0]
  assert.equal(t.lastMonthRevenue, 129409)
  assert.equal(t.lastYearRevenue, 98744)
  assert.equal(t.momChange, 11.6)
  assert.equal(t.yoyChange, 46.3)
  assert.equal(t.momDelta, 15036)
})

test('a category that earned last year and nothing now still appears', () => {
  // The most interesting row on the report must not vanish because it has no
  // current rows to iterate over.
  const out = buildRevenue([], [], [row('Stretch', 'STRETCH', 40000)])
  assert.equal(out.others.length, 1)
  assert.equal(out.others[0].revenue, 0)
  assert.equal(out.others[0].lastYearRevenue, 40000)
  assert.equal(out.others[0].yoyChange, -100)
})

test('a brand new category reports no change rather than a fake one', () => {
  const out = buildRevenue([row('Pickleball Events', 'PICKLEBALL EVENTS', 5000)], [], [])
  assert.equal(out.others[0].yoyChange, null)
  assert.equal(out.others[0].momChange, null)
  // The delta is still real and worth showing.
  assert.equal(out.others[0].yoyDelta, 5000)
})

// --- the rename that would break year-over-year ------------------------------

test('a renamed centre folds into one category across both windows', () => {
  // PERSONAL TRAINING was Eugene's label for TRAINING until September 2024.
  // Comparing this August to last August with the two kept apart would show a
  // collapse at one club that is really just a relabelling.
  const out = buildRevenue(
    [row('Training', 'TRAINING', 144445, 3)],
    [],
    [row('Training', 'TRAINING', 60000, 3), row('Training', 'PERSONAL TRAINING', 38744, 3)],
  )
  const t = out.headline[0]
  assert.equal(t.lastYearRevenue, 98744)
  assert.equal(t.yoyChange, 46.3)
})

test('a category shows the centres behind it, in both windows', () => {
  // The only way a reader can audit the mapping, or notice a new code landing
  // in the wrong place.
  const out = buildRevenue(
    [row('Training', 'TRAINING', 144445, 3)],
    [],
    [row('Training', 'TRAINING', 60000, 3), row('Training', 'PERSONAL TRAINING', 38744, 3)],
  )
  const centers = out.headline[0].centers
  assert.equal(centers.length, 2)
  const legacy = centers.find(c => c.profitCenter === 'PERSONAL TRAINING')
  assert.equal(legacy.revenue, 0)
  assert.equal(legacy.lastYearRevenue, 38744)
})

// --- refunds -----------------------------------------------------------------

test('refunds are excluded from gross and included in net', () => {
  const out = buildRevenue([
    row('Dues', 'DUES', 1000, 1),
    row('Refunds', 'REFUNDS', -250),
  ], [], [])

  assert.equal(out.summary.gross, 1000)
  assert.equal(out.summary.refunds, -250)
  assert.equal(out.summary.net, 750)
})

test('refunds still get their own row and are flagged', () => {
  const out = buildRevenue([row('Refunds', 'REFUNDS', -250)], [], [])
  assert.equal(out.others[0].category, 'Refunds')
  assert.equal(out.others[0].negative, true)
})

test('gross comparisons also exclude refunds on both sides', () => {
  // Otherwise a quiet month for refunds reads as revenue growth.
  const out = buildRevenue(
    [row('Dues', 'DUES', 1000, 1), row('Refunds', 'REFUNDS', -500)],
    [row('Dues', 'DUES', 1000, 1), row('Refunds', 'REFUNDS', -100)],
    [],
  )
  assert.equal(out.summary.gross, 1000)
  assert.equal(out.summary.grossLastMonth, 1000)
  assert.equal(out.summary.grossMom, 0)
})

// --- the comparison windows -------------------------------------------------
//
// Length is the whole game. The default view is month-to-date, so comparing 27
// days of August against all 31 of July would report a 13% fall that is nothing
// but a shorter window.

const { shiftedWindow, spanDays } = require('./comparisonWindow')

test('a month-to-date window compares against the same number of days', () => {
  const w = shiftedWindow('2026-08-01', '2026-08-27', { months: 1 })
  assert.deepEqual(w, { start: '2026-07-01', end: '2026-07-27' })
  assert.equal(spanDays('2026-08-01', '2026-08-27'), spanDays(w.start, w.end))
})

test('the year comparison lands on the same dates, not 365 days back', () => {
  const w = shiftedWindow('2026-08-01', '2026-08-27', { years: 1 })
  assert.deepEqual(w, { start: '2025-08-01', end: '2025-08-27' })
})

test('a short month does not shrink the comparison window', () => {
  // March has 31 days and February 28. Shifting both ends independently would
  // compare 31 days against 28 and invent a 10% drop.
  const w = shiftedWindow('2026-03-01', '2026-03-31', { months: 1 })
  assert.equal(spanDays(w.start, w.end), 31)
  assert.equal(w.start, '2026-02-01')
  assert.equal(w.end, '2026-03-03')   // runs past month end to keep the length
})

test('a leap day does not shift the year comparison', () => {
  const w = shiftedWindow('2025-03-01', '2025-03-10', { years: 1 })
  assert.deepEqual(w, { start: '2024-03-01', end: '2024-03-10' })
  assert.equal(spanDays(w.start, w.end), 10)
})

test('a single day compares against a single day', () => {
  assert.deepEqual(shiftedWindow('2026-08-27', '2026-08-27', { months: 1 }),
    { start: '2026-07-27', end: '2026-07-27' })
})

// --- Dues is DUES alone (migration 171) --------------------------------------

test('the All list is largest first, not priority-first', () => {
  // This table answers "what is big". A $4,138 snack line above a $289,021
  // guest-fee line, because snacks happen to be a priority center, answers a
  // different question badly.
  const out = buildRevenue([
    row('Snacks', 'WCS SNACKS', 4138, 6),
    row('Guest Fees', 'GUEST FEES', 289021),
    row('Dues', 'DUES', 515345, 1),
  ], [], [])

  assert.deepEqual(out.all.map(r => r.category), ['Dues', 'Guest Fees', 'Snacks'])
  // The priority table keeps its own curated order.
  assert.deepEqual(out.headline.map(r => r.category), ['Dues', 'Snacks'])
})

test('every center appears in All, priority ones included', () => {
  const out = buildRevenue([
    row('Dues', 'DUES', 515345, 1),
    row('A2 Exec Dues', 'A2EXECDUES', 12879),
  ], [], [])
  assert.equal(out.all.length, 2)
  assert.equal(out.headline.length, 1)
  assert.equal(out.others.length, 1)
})

test('a separated dues product keeps its own comparison', () => {
  // Rolled into Dues it was $12,879 hidden inside $528,224, where nobody could
  // see it move.
  const out = buildRevenue(
    [row('A2 Exec Dues', 'A2EXECDUES', 12879)],
    [row('A2 Exec Dues', 'A2EXECDUES', 11000)],
    [row('A2 Exec Dues', 'A2EXECDUES', 9000)],
  )
  const a2 = out.others[0]
  assert.equal(a2.category, 'A2 Exec Dues')
  assert.equal(a2.momChange, 17.1)
  assert.equal(a2.yoyChange, 43.1)
})
