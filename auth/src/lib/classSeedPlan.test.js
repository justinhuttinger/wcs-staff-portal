const test = require('node:test')
const assert = require('node:assert')
const {
  SEED_WINDOW_DAYS, pickCount, pickAccounts, offsetForEvent, selectClassesToSeed,
} = require('./classSeedPlan')

const ACCOUNTS = ['a', 'b', 'c', 'd', 'e'].map(id => ({ member_id: id, active: true }))

test('the window matches what ABC actually allows', () => {
  // ABC will not take a booking more than 14 days out.
  assert.strictEqual(SEED_WINDOW_DAYS, 14)
})

test('pickCount is inclusive of both ends', () => {
  assert.strictEqual(pickCount(3, 6, () => 0), 3)
  assert.strictEqual(pickCount(3, 6, () => 0.999), 6)
})

test('pickCount covers every value in the range', () => {
  const seen = new Set()
  for (let i = 0; i < 1000; i++) seen.add(pickCount(1, 3, () => i / 1000))
  assert.deepStrictEqual([...seen].sort(), [1, 2, 3])
})

test('pickCount handles a single-value range and a zero floor', () => {
  assert.strictEqual(pickCount(4, 4, () => 0.5), 4)
  assert.strictEqual(pickCount(0, 0, () => 0.9), 0)
})

test('pickCount does not go negative on nonsense input', () => {
  assert.strictEqual(pickCount(-5, -1, () => 0), 0)
})

test('pickAccounts never returns more than the pool holds', () => {
  assert.strictEqual(pickAccounts(ACCOUNTS, 99, 0).length, 5)
})

test('pickAccounts rotates so the same names are not always used', () => {
  const first = pickAccounts(ACCOUNTS, 2, 0).map(a => a.member_id)
  const later = pickAccounts(ACCOUNTS, 2, 3).map(a => a.member_id)
  assert.deepStrictEqual(first, ['a', 'b'])
  assert.deepStrictEqual(later, ['d', 'e'])
})

test('pickAccounts wraps around the end of the pool', () => {
  assert.deepStrictEqual(pickAccounts(ACCOUNTS, 3, 4).map(a => a.member_id), ['e', 'a', 'b'])
})

test('pickAccounts skips deactivated accounts', () => {
  const pool = [{ member_id: 'a', active: false }, { member_id: 'b', active: true }]
  assert.deepStrictEqual(pickAccounts(pool, 2, 0).map(a => a.member_id), ['b'])
})

test('pickAccounts returns nothing for an empty pool or a zero count', () => {
  assert.deepStrictEqual(pickAccounts([], 3, 0), [])
  assert.deepStrictEqual(pickAccounts(ACCOUNTS, 0, 0), [])
})

test('offsetForEvent is stable for the same class', () => {
  // Re-running the job must reuse the same accounts rather than piling on more.
  assert.strictEqual(offsetForEvent('evt-1'), offsetForEvent('evt-1'))
  assert.notStrictEqual(offsetForEvent('evt-1'), offsetForEvent('evt-2'))
})

const NOW = '2026-08-01T00:00:00.000Z'
const HORIZON = '2026-08-15T00:00:00.000Z'
const base = { event_id: 'e1', member_count: 0, status: 'Pending', event_timestamp: '2026-08-05T13:00:00.000Z' }

test('selectClassesToSeed takes an empty future class', () => {
  assert.strictEqual(selectClassesToSeed([base], { nowIso: NOW, horizonIso: HORIZON }).length, 1)
})

test('selectClassesToSeed leaves classes that already have someone booked', () => {
  // Once a real member books, there is nothing to fix, and house accounts must
  // never stack on top of real ones.
  assert.strictEqual(selectClassesToSeed([{ ...base, member_count: 1 }], { nowIso: NOW, horizonIso: HORIZON }).length, 0)
})

test('selectClassesToSeed ignores classes in the past', () => {
  assert.strictEqual(
    selectClassesToSeed([{ ...base, event_timestamp: '2026-07-30T13:00:00.000Z' }], { nowIso: NOW, horizonIso: HORIZON }).length,
    0,
  )
})

test('selectClassesToSeed ignores classes past the booking horizon', () => {
  assert.strictEqual(
    selectClassesToSeed([{ ...base, event_timestamp: '2026-09-01T13:00:00.000Z' }], { nowIso: NOW, horizonIso: HORIZON }).length,
    0,
  )
})

test('selectClassesToSeed skips cancelled classes and unbooked placeholders', () => {
  assert.strictEqual(selectClassesToSeed([{ ...base, status: 'Canceled' }], { nowIso: NOW, horizonIso: HORIZON }).length, 0)
  assert.strictEqual(selectClassesToSeed([{ ...base, unbooked: true }], { nowIso: NOW, horizonIso: HORIZON }).length, 0)
})

test('selectClassesToSeed tolerates junk rows', () => {
  assert.strictEqual(selectClassesToSeed([null, {}, { event_id: 'x' }], { nowIso: NOW, horizonIso: HORIZON }).length, 0)
  assert.deepStrictEqual(selectClassesToSeed(null, {}), [])
})
