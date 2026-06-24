import { test } from 'node:test'
import assert from 'node:assert/strict'
import pkg from './gapCheck.js'
const { findMissingRevenueDays } = pkg

// Daily-import ranges are single-day (period_start === period_end).
const day = (d) => ({ period_start: d, period_end: d })

test('returns empty when every day in the window is covered by daily imports', () => {
  const ranges = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map(day)
  const missing = findMissingRevenueDays(ranges, { today: '2026-06-06', lookbackDays: 5 })
  assert.deepEqual(missing, [])
})

test('flags a single missing day (the June 4 scenario)', () => {
  const ranges = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-05'].map(day)
  const missing = findMissingRevenueDays(ranges, { today: '2026-06-06', lookbackDays: 5 })
  assert.deepEqual(missing, ['2026-06-04'])
})

test('a multi-day backfill range covers days inside it', () => {
  // One backfill import spanning Jun 1–5 should satisfy the whole window.
  const ranges = [{ period_start: '2026-06-01', period_end: '2026-06-05' }]
  const missing = findMissingRevenueDays(ranges, { today: '2026-06-06', lookbackDays: 5 })
  assert.deepEqual(missing, [])
})

test('excludes today (the in-flight day not yet delivered)', () => {
  // No import for 2026-06-06 (today) — must NOT be flagged.
  const ranges = ['2026-06-04', '2026-06-05'].map(day)
  const missing = findMissingRevenueDays(ranges, { today: '2026-06-06', lookbackDays: 2 })
  assert.deepEqual(missing, [])
})

test('reports multiple gaps in ascending date order', () => {
  const ranges = ['2026-06-01', '2026-06-04'].map(day)
  const missing = findMissingRevenueDays(ranges, { today: '2026-06-06', lookbackDays: 5 })
  assert.deepEqual(missing, ['2026-06-02', '2026-06-03', '2026-06-05'])
})

test('handles month boundaries via real calendar arithmetic', () => {
  // Window of 4 days ending yesterday: May 29, 30, 31, Jun 1. May 29 is uncovered.
  const ranges = ['2026-05-30', '2026-05-31', '2026-06-01'].map(day)
  const missing = findMissingRevenueDays(ranges, { today: '2026-06-02', lookbackDays: 4 })
  assert.deepEqual(missing, ['2026-05-29'])
})
