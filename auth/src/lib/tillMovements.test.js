// auth/src/lib/tillMovements.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const {
  REASONS, reasonLabel, validateMovement, netMovementsByDay,
} = require('./tillMovements')

// --- reasons ---------------------------------------------------------------

test('every reason belongs to exactly one direction', () => {
  const out = REASONS.out.map(r => r.key)
  const inn = REASONS.in.map(r => r.key)
  // 'other' is the one key deliberately shared by both directions.
  const shared = out.filter(k => inn.includes(k))
  assert.deepEqual(shared, ['other'])
})

test('reasonLabel falls back to the raw key for a retired reason', () => {
  assert.equal(reasonLabel('out', 'bank_drop'), 'Bank drop')
  assert.equal(reasonLabel('out', 'made_up'), 'made_up')
})

// --- validateMovement ------------------------------------------------------

const TODAY = '2026-08-31'

test('accepts a plain bank drop', () => {
  const r = validateMovement({ direction: 'out', reason: 'bank_drop', amount: 200, business_date: TODAY }, TODAY)
  assert.equal(r.error, undefined)
  assert.equal(r.value.amount, 200)
  assert.equal(r.value.business_date, TODAY)
  assert.equal(r.value.note, null)
})

test('defaults the business date to today', () => {
  const r = validateMovement({ direction: 'in', reason: 'from_safe', amount: 50 }, TODAY)
  assert.equal(r.value.business_date, TODAY)
})

test('rounds the amount to cents', () => {
  const r = validateMovement({ direction: 'out', reason: 'bank_drop', amount: '20.005', business_date: TODAY }, TODAY)
  assert.equal(r.value.amount, 20.01)
})

test('rejects a bad direction', () => {
  assert.match(validateMovement({ direction: 'sideways', reason: 'other', amount: 5, note: 'x' }, TODAY).error, /direction/)
})

test('rejects a reason that does not belong to the direction', () => {
  // from_safe is cash coming IN; it cannot describe cash going out.
  assert.match(validateMovement({ direction: 'out', reason: 'from_safe', amount: 5 }, TODAY).error, /reason/)
})

test('rejects a zero, negative or non-numeric amount', () => {
  for (const amount of [0, -5, 'abc', null, undefined, Infinity]) {
    assert.match(validateMovement({ direction: 'out', reason: 'bank_drop', amount }, TODAY).error, /amount/)
  }
})

test('rejects an implausibly large amount', () => {
  assert.match(validateMovement({ direction: 'out', reason: 'bank_drop', amount: 50000 }, TODAY).error, /amount/)
})

test('requires a note for payout and other', () => {
  assert.match(validateMovement({ direction: 'out', reason: 'payout', amount: 20 }, TODAY).error, /note/)
  assert.match(validateMovement({ direction: 'out', reason: 'other', amount: 20, note: '   ' }, TODAY).error, /note/)
  assert.equal(validateMovement({ direction: 'out', reason: 'payout', amount: 20, note: 'Bought stamps' }, TODAY).error, undefined)
})

test('rejects a future business date', () => {
  assert.match(validateMovement({ direction: 'out', reason: 'bank_drop', amount: 20, business_date: '2026-09-01' }, TODAY).error, /date/)
})

test('allows backdating up to 7 days but no further', () => {
  assert.equal(validateMovement({ direction: 'out', reason: 'bank_drop', amount: 20, business_date: '2026-08-24' }, TODAY).error, undefined)
  assert.match(validateMovement({ direction: 'out', reason: 'bank_drop', amount: 20, business_date: '2026-08-23' }, TODAY).error, /date/)
})

test('rejects a malformed business date', () => {
  assert.match(validateMovement({ direction: 'out', reason: 'bank_drop', amount: 20, business_date: '8/31/2026' }, TODAY).error, /date/)
})

test('trims the note and caps its length', () => {
  const r = validateMovement({ direction: 'out', reason: 'other', amount: 20, note: '  ' + 'x'.repeat(600) + '  ' }, TODAY)
  assert.equal(r.value.note.length, 500)
})

// --- netMovementsByDay -----------------------------------------------------

test('buckets out and in per business date', () => {
  const m = netMovementsByDay([
    { business_date: '2026-08-30', direction: 'out', amount: '200.00' },
    { business_date: '2026-08-30', direction: 'out', amount: '50.00' },
    { business_date: '2026-08-30', direction: 'in', amount: '20.00' },
    { business_date: '2026-08-31', direction: 'out', amount: '10.00' },
  ])
  assert.deepEqual(m.get('2026-08-30'), { manualOut: 250, manualIn: 20 })
  assert.deepEqual(m.get('2026-08-31'), { manualOut: 10, manualIn: 0 })
})

test('voided rows do not count', () => {
  const m = netMovementsByDay([
    { business_date: '2026-08-30', direction: 'out', amount: 200, voided_at: '2026-08-30T22:00:00Z' },
    { business_date: '2026-08-30', direction: 'out', amount: 40 },
  ])
  assert.deepEqual(m.get('2026-08-30'), { manualOut: 40, manualIn: 0 })
})

test('sums stay penny-exact', () => {
  const m = netMovementsByDay([
    { business_date: '2026-08-30', direction: 'out', amount: 0.1 },
    { business_date: '2026-08-30', direction: 'out', amount: 0.2 },
  ])
  assert.equal(m.get('2026-08-30').manualOut, 0.3)
})

test('empty input yields an empty map', () => {
  assert.equal(netMovementsByDay([]).size, 0)
  assert.equal(netMovementsByDay(null).size, 0)
})

test('a timestamp business_date is normalized to its date', () => {
  const m = netMovementsByDay([{ business_date: '2026-08-30T00:00:00.000Z', direction: 'out', amount: 5 }])
  assert.deepEqual(m.get('2026-08-30'), { manualOut: 5, manualIn: 0 })
})
