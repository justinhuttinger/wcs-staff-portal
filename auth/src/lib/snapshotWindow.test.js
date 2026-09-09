const test = require('node:test')
const assert = require('node:assert')
const { daysInWindow, priorMonthWindow } = require('./snapshotWindow')

// ---------------------------------------------------------------------------
// daysInWindow — the denominator for Avg Daily Check-ins.
//
// INCLUSIVE of both ends: the 1st to the 8th is eight days of trading, not
// seven. Getting this off by one would quietly overstate every daily average
// by up to a day's worth of traffic.
// ---------------------------------------------------------------------------

test('a single day is one day, not zero', () => {
  assert.strictEqual(daysInWindow('2026-09-08', '2026-09-08'), 1)
})

test('both ends are counted', () => {
  assert.strictEqual(daysInWindow('2026-09-01', '2026-09-08'), 8)
})

test('a whole month is its own length', () => {
  assert.strictEqual(daysInWindow('2026-08-01', '2026-08-31'), 31)
  assert.strictEqual(daysInWindow('2026-02-01', '2026-02-28'), 28)
})

// Parsed by hand rather than through Date, for the same reason formatDateLong
// is: new Date('2026-08-28') is midnight UTC and a server west of Greenwich
// would land on the previous day.
test('a month boundary does not lose or gain a day', () => {
  assert.strictEqual(daysInWindow('2026-08-28', '2026-09-02'), 6)
})

test('a leap year February is 29 days', () => {
  assert.strictEqual(daysInWindow('2028-02-01', '2028-02-29'), 29)
})

test('garbage or a reversed window yields null rather than a negative average', () => {
  assert.strictEqual(daysInWindow('2026-09-08', '2026-09-01'), null)
  assert.strictEqual(daysInWindow('', '2026-09-01'), null)
  assert.strictEqual(daysInWindow(null, null), null)
  assert.strictEqual(daysInWindow('not-a-date', 'nope'), null)
})

// The reason the average is worth having at all: the comparison window is NOT
// always the same length, because priorMonthWindow clamps the day to the
// shorter month. Comparing totals across 31 days and 28 is a 10% handicap that
// has nothing to do with how busy the club was.
test('the prior window can be a different length, which is why an average is fairer', () => {
  const prior = priorMonthWindow('2026-03-01', '2026-03-31')
  assert.strictEqual(prior.start, '2026-02-01')
  assert.strictEqual(prior.end, '2026-02-28')
  assert.strictEqual(daysInWindow('2026-03-01', '2026-03-31'), 31)
  assert.strictEqual(daysInWindow(prior.start, prior.end), 28)
})
