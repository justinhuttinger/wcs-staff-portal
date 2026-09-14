const test = require('node:test')
const assert = require('node:assert')
const { resolveWindow, trendStart, TREND_MONTHS } = require('./revenueAnalysisReport')

// ---------------------------------------------------------------------------
// The window arithmetic, now that two reports share it.
//
// This module was the body of GET /analytics/revenue and is now also what
// Reporting's Revenue report draws. The tests that matter are the ones about
// which window a caller ends up with, because that is the half a second route
// could have got subtly different if it had been copied instead of shared.
// ---------------------------------------------------------------------------

test('no dates asked for means month to date, and says so', () => {
  const w = resolveWindow({})
  assert.equal(w.anchoredOn, 'month to date')
  assert.match(w.requestedStart, /^\d{4}-\d{2}-01$/)
  assert.ok(w.requestedStart <= w.requestedEnd)
})

test('dates asked for are honoured, and say so', () => {
  const w = resolveWindow({ start: '2026-08-01', end: '2026-08-31' })
  assert.deepEqual(
    { start: w.requestedStart, end: w.requestedEnd, anchoredOn: w.anchoredOn },
    { start: '2026-08-01', end: '2026-08-31', anchoredOn: 'request' }
  )
})

// Anything that is not a YYYY-MM-DD falls back rather than reaching the RPCs as
// a malformed bound. A route may pass undefined, an empty string, or whatever a
// user put in a query string.
test('an unparseable date falls back to month to date rather than through', () => {
  for (const bad of [undefined, null, '', 'yesterday', '2026-8-1', '08/01/2026']) {
    assert.equal(resolveWindow({ start: bad, end: bad }).anchoredOn, 'month to date',
      `${JSON.stringify(bad)} was treated as a date`)
  }
})

// A 400 rather than an empty report: a backwards window returns no rows from
// every RPC, which would render as a month where the club took nothing.
test('a backwards window is refused with a 400, not answered with zeroes', () => {
  assert.throws(
    () => resolveWindow({ start: '2026-09-01', end: '2026-08-01' }),
    err => err.status === 400 && /start must not be after end/.test(err.message)
  )
})

// The trend window is whole calendar months back from the END month, inclusive
// of it, because the chart's x-axis is months. Counting back 25 from September
// has to land on the first of September two years earlier, not on a mid-month
// date 25 months of varying length ago.
test('the trend starts on the first of the month, TREND_MONTHS back inclusive', () => {
  assert.equal(trendStart('2026-09-14', 25), '2024-09-01')
  assert.equal(trendStart('2026-09-01', 1), '2026-09-01')
  assert.equal(trendStart('2026-01-31', 2), '2025-12-01')
})

// Leap day is the case that breaks a "subtract N days" implementation.
test('the trend start does not drift across a leap year', () => {
  assert.equal(trendStart('2024-02-29', 12), '2023-03-01')
})

test('the trend window is 25 months', () => {
  assert.equal(TREND_MONTHS, 25)
})
