import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pct, gapInfo, trendDirection, monthRanges } from './kpiMath.js'

test('pct returns rounded percentage', () => {
  assert.equal(pct(50, 200), 25)
  assert.equal(pct(1, 3), 33)
})

test('pct returns null when denominator is 0 or missing', () => {
  assert.equal(pct(5, 0), null)
  assert.equal(pct(5, null), null)
  assert.equal(pct(5, undefined), null)
})

test('gapInfo flags above / below / met goal', () => {
  assert.deepEqual(gapInfo(70, 65), { diff: 5, tone: 'above', text: '+5% above goal' })
  assert.deepEqual(gapInfo(58, 65), { diff: -7, tone: 'below', text: '-7% below goal' })
  assert.deepEqual(gapInfo(65, 65), { diff: 0, tone: 'above', text: 'Goal met' })
})

test('gapInfo returns null when actual or goal missing', () => {
  assert.equal(gapInfo(null, 65), null)
  assert.equal(gapInfo(70, null), null)
})

test('trendDirection compares last two points distance to goal', () => {
  assert.equal(trendDirection([{ value: 50 }, { value: 60 }], 65), 'toward')
  assert.equal(trendDirection([{ value: 60 }, { value: 50 }], 65), 'away')
  assert.equal(trendDirection([{ value: 60 }, { value: 70 }], 65), 'flat')
})

test('trendDirection ignores null points and returns null when <2 real points', () => {
  assert.equal(trendDirection([{ value: null }, { value: 60 }], 65), null)
  assert.equal(trendDirection([], 65), null)
  assert.equal(trendDirection([{ value: 60 }], 65), null)
})

test('trendDirection returns null when no goal', () => {
  assert.equal(trendDirection([{ value: 50 }, { value: 60 }], null), null)
})

test('monthRanges returns count buckets ending in the reference month, local dates', () => {
  const ranges = monthRanges(new Date(2026, 5, 15), 6) // June 2026
  assert.equal(ranges.length, 6)
  assert.equal(ranges[0].start, '2026-01-01')
  assert.equal(ranges[0].end, '2026-01-31')
  assert.equal(ranges[0].label, 'Jan')
  assert.equal(ranges[5].start, '2026-06-01')
  assert.equal(ranges[5].end, '2026-06-30')
  assert.equal(ranges[5].label, 'Jun')
  assert.equal(ranges[5].key, '2026-06')
})
