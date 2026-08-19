const test = require('node:test')
const assert = require('node:assert')
const { diffSnapshots, computeRates, COUNTER_FIELDS } = require('./emailSnapshotDiff')

// A full snapshot row: every counter present, overridden by `over`.
const snap = (over = {}) =>
  Object.assign(Object.fromEntries(COUNTER_FIELDS.map(f => [f, 0])), over)

test('diffSnapshots: subtracts the baseline from the latest', () => {
  const out = diffSnapshots(snap({ sent: 100, delivered: 98, opened: 30 }), snap({ sent: 60, delivered: 59, opened: 18 }))
  assert.strictEqual(out.sent, 40)
  assert.strictEqual(out.delivered, 39)
  assert.strictEqual(out.opened, 12)
  assert.strictEqual(out.is_lifetime, false)
})

test('diffSnapshots: no baseline returns lifetime totals flagged as such', () => {
  const out = diffSnapshots(snap({ sent: 100, opened: 30 }), null)
  assert.strictEqual(out.sent, 100)
  assert.strictEqual(out.opened, 30)
  assert.strictEqual(out.is_lifetime, true)
})

test('diffSnapshots: a restated (negative) counter clamps to zero', () => {
  const out = diffSnapshots(snap({ sent: 50 }), snap({ sent: 80 }))
  assert.strictEqual(out.sent, 0)
})

test('diffSnapshots: null latest returns null', () => {
  assert.strictEqual(diffSnapshots(null, snap({ sent: 5 })), null)
})

test('diffSnapshots: missing counters are treated as zero', () => {
  const out = diffSnapshots({ sent: 10 }, {})
  assert.strictEqual(out.sent, 10)
  assert.strictEqual(out.opened, 0)
})

test('computeRates: opens/clicks/replies over delivered, bounces over sent', () => {
  const r = computeRates({ sent: 100, delivered: 80, opened: 20, clicked: 8, replied: 4, unsubscribed: 2, permanent_fail: 3, temporary_fail: 2 })
  assert.strictEqual(r.open_rate, 25)
  assert.strictEqual(r.click_rate, 10)
  assert.strictEqual(r.reply_rate, 5)
  assert.strictEqual(r.unsubscribe_rate, 2.5)
  assert.strictEqual(r.bounce_rate, 5)
})

test('computeRates: zero denominators yield zero, never NaN', () => {
  const r = computeRates({ sent: 0, delivered: 0, opened: 0 })
  assert.strictEqual(r.open_rate, 0)
  assert.strictEqual(r.bounce_rate, 0)
})
