const test = require('node:test')
const assert = require('node:assert')
const { buildTill, MATERIAL_VARIANCE } = require('./tillAnalytics')

const SETTINGS = [{ club_number: '31599', standard_float: 100, drop_upc: 'XXXCASHDROPXXX' }]

const cashRow = (slug, date, sales = 0, refunds = 0, drops = 0) => ({
  slug, club_number: '31599', business_date: date,
  cash_sales: sales, cash_refunds: refunds, cash_drops: drops,
})

const count = (slug, date, type, amount, who = 'Alex') => ({
  slug, club_number: '31599', business_date: date,
  count_type: type, counted_amount: amount, employee_name: who,
})

const opts = { settings: SETTINGS }

test('a balanced day reconciles to zero', () => {
  // float 100 + sales 50 = expected 150, counted 150.
  const out = buildTill(
    [cashRow('keizer', '2026-08-01', 50)],
    [count('keizer', '2026-08-01', 'open', 100), count('keizer', '2026-08-01', 'close', 150)],
    opts
  )
  assert.equal(out.days[0].overShort, 0)
  assert.equal(out.days[0].status, 'complete')
  assert.equal(out.summary.net, 0)
})

test('refunds and drops both reduce the expected close', () => {
  // 100 + 50 - 10 refund - 20 drop = 120.
  const out = buildTill(
    [cashRow('keizer', '2026-08-01', 50, 10, 20)],
    [count('keizer', '2026-08-01', 'open', 100), count('keizer', '2026-08-01', 'close', 120)],
    opts
  )
  assert.equal(out.days[0].expectedClose, 120)
  assert.equal(out.days[0].overShort, 0)
})

// --- the rule that stops a bad drawer looking perfect ----------------------

test('shortages and overages do not cancel in the absolute figure', () => {
  const out = buildTill(
    [cashRow('keizer', '2026-08-01', 0), cashRow('keizer', '2026-08-02', 0)],
    [
      count('keizer', '2026-08-01', 'open', 100), count('keizer', '2026-08-01', 'close', 50),  // -50
      count('keizer', '2026-08-02', 'open', 100), count('keizer', '2026-08-02', 'close', 150), // +50
    ],
    opts
  )
  assert.equal(out.summary.net, 0)
  // The drawer did not balance on either day, and the report must say so.
  assert.equal(out.summary.absolute, 100)
  assert.equal(out.summary.materialDays, 2)
})

test('clubs rank by absolute variance, not net', () => {
  const out = buildTill(
    [cashRow('keizer', '2026-08-01'), cashRow('keizer', '2026-08-02'), cashRow('salem', '2026-08-01')],
    [
      count('keizer', '2026-08-01', 'open', 100), count('keizer', '2026-08-01', 'close', 40),
      count('keizer', '2026-08-02', 'open', 100), count('keizer', '2026-08-02', 'close', 160),
      count('salem', '2026-08-01', 'open', 100), count('salem', '2026-08-01', 'close', 90),
    ],
    opts
  )
  // Keizer nets zero but is off by $120 across two days; Salem nets -$10.
  assert.equal(out.byClub[0].slug, 'keizer')
  assert.equal(out.byClub[0].net, 0)
  assert.equal(out.byClub[0].absolute, 120)
})

// --- missing counts are not zeros -----------------------------------------

test('a day with no closing count is missing, never a balanced day', () => {
  // A club that stops counting must not appear to have perfect drawers.
  const out = buildTill(
    [cashRow('keizer', '2026-08-01', 500)],
    [count('keizer', '2026-08-01', 'open', 100)],
    opts
  )
  assert.equal(out.days[0].status, 'missing_close')
  assert.equal(out.days[0].overShort, null)
  assert.equal(out.summary.reconciledDays, 0)
  assert.equal(out.summary.missingClose, 1)
  assert.match(out.notes.coverage, /cannot be\s+reconciled/)
})

test('a day with neither count is missing_both', () => {
  const out = buildTill([cashRow('keizer', '2026-08-01', 500)], [], opts)
  assert.equal(out.days[0].status, 'missing_both')
  assert.equal(out.summary.missingBoth, 1)
  assert.equal(out.summary.countRate, 0)
})

test('a missing opening count falls back to the standard float', () => {
  // Without an open we assume par rather than refusing to reconcile, matching
  // reconcileDay. 100 par + 25 sales = 125.
  const out = buildTill(
    [cashRow('keizer', '2026-08-01', 25)],
    [count('keizer', '2026-08-01', 'close', 125)],
    opts
  )
  assert.equal(out.days[0].status, 'missing_open')
  assert.equal(out.days[0].overShort, 0)
})

test('a day with a count but no cash activity still reconciles', () => {
  const out = buildTill([], [
    count('keizer', '2026-08-01', 'open', 100), count('keizer', '2026-08-01', 'close', 100),
  ], opts)
  assert.equal(out.days.length, 1)
  assert.equal(out.days[0].overShort, 0)
})

// --- people ----------------------------------------------------------------

test('variance is attributed to whoever closed', () => {
  const out = buildTill(
    [cashRow('keizer', '2026-08-01')],
    [count('keizer', '2026-08-01', 'open', 100, 'Opener'), count('keizer', '2026-08-01', 'close', 80, 'Closer')],
    opts
  )
  assert.equal(out.byPerson.length, 1)
  assert.equal(out.byPerson[0].name, 'Closer')
  assert.equal(out.byPerson[0].absolute, 20)
})

test('an unnamed closer is left out rather than invented', () => {
  // Bucketing these as "Unknown" would name a person who does not exist.
  const out = buildTill(
    [cashRow('keizer', '2026-08-01')],
    [count('keizer', '2026-08-01', 'close', 80, null)],
    opts
  )
  assert.deepEqual(out.byPerson, [])
  // The day is still reconciled and still counts against the club.
  assert.equal(out.summary.absolute, 20)
})

// --- thresholds ------------------------------------------------------------

test('small change is not flagged as material', () => {
  const out = buildTill(
    [cashRow('keizer', '2026-08-01')],
    [count('keizer', '2026-08-01', 'open', 100), count('keizer', '2026-08-01', 'close', 100 - (MATERIAL_VARIANCE - 1))],
    opts
  )
  assert.equal(out.days[0].material, false)
  assert.equal(out.summary.materialDays, 0)
})

test('exactly at the threshold is material', () => {
  const out = buildTill(
    [cashRow('keizer', '2026-08-01')],
    [count('keizer', '2026-08-01', 'open', 100), count('keizer', '2026-08-01', 'close', 100 - MATERIAL_VARIANCE)],
    opts
  )
  assert.equal(out.days[0].material, true)
})

test('the float history overrides the standard float for older days', () => {
  const out = buildTill(
    [cashRow('keizer', '2026-08-01')],
    [count('keizer', '2026-08-01', 'close', 250)],
    {
      settings: SETTINGS,
      floatHistory: [{ club_number: '31599', effective_date: '2026-07-01', standard_float: 250 }],
    }
  )
  // Par is 250 from July, not the current 100, so the drawer balances.
  assert.equal(out.days[0].overShort, 0)
})
