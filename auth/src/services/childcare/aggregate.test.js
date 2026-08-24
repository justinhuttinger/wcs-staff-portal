// node --test auth/src/services/childcare/aggregate.test.js
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildLedger, buildDayOfWeek, buildTrend, buildTotals, stats, dayOfWeek } = require('./aggregate')

const e = (date, block, over1, under1, patch = {}) => ({
  location_slug: 'milwaukie', date, block, over1, under1,
  submitted_by: 'Justin Huttinger', submissions: 1, ...patch,
})

test('dayOfWeek reads the calendar date with no timezone in play', () => {
  assert.equal(dayOfWeek('2026-08-24'), 1) // Monday
  assert.equal(dayOfWeek('2026-08-30'), 0) // Sunday
})

test('stats excludes unknown blocks instead of averaging them as zero', () => {
  // A skipped checklist is UNKNOWN. Counting it as 0 would drag the average
  // down and understaff the block.
  assert.deepEqual(stats([10, null, 4]), { avg: 7, peak: 10, total: 14, occurrences: 2 })
  assert.deepEqual(stats([null, null]), { avg: null, peak: null, total: 0, occurrences: 0 })
  assert.deepEqual(stats([0, 4]), { avg: 2, peak: 4, total: 4, occurrences: 2 })
})

test('buildLedger puts both blocks on one row per club per day, newest first', () => {
  const rows = buildLedger([
    e('2026-08-24', 'morning', 3, 1),
    e('2026-08-24', 'evening', 9, 9),
    e('2026-08-25', 'morning', 5, 2),
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].date, '2026-08-25')        // newest first
  assert.equal(rows[1].day_of_week, 'Monday')
  assert.equal(rows[1].morning.total, 4)
  assert.equal(rows[1].evening.total, 18)
  assert.equal(rows[1].day_total, 22)
})

test('buildLedger omits days with nothing submitted rather than showing blanks', () => {
  const rows = buildLedger([e('2026-08-24', 'evening', 9, 9)])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].morning, null)             // that block simply has no data
  assert.equal(rows[0].day_total, 18)
})

test('buildLedger surfaces corrections', () => {
  const rows = buildLedger([e('2026-08-24', 'evening', 9, 9, { submissions: 2 })])
  assert.equal(rows[0].corrections, 1)
})

test('buildDayOfWeek averages per occurrence and reports the sample size', () => {
  const rows = buildDayOfWeek([
    e('2026-08-17', 'evening', 10, 2),  // Monday
    e('2026-08-24', 'evening', 8, 4),   // Monday
    e('2026-08-18', 'evening', 20, 0),  // Tuesday
  ])
  const mon = rows.find((r) => r.day_of_week === 'Monday' && r.block === 'evening')
  assert.equal(mon.over1.avg, 9)          // (10+8)/2, NOT a range-dependent total
  assert.equal(mon.over1.peak, 10)
  assert.equal(mon.over1.total, 18)
  assert.equal(mon.over1.occurrences, 2)  // so a 2-sample average is never mistaken for 20
  assert.equal(mon.combined.avg, 12)
  const tue = rows.find((r) => r.day_of_week === 'Tuesday')
  assert.equal(tue.over1.occurrences, 1)
})

test('buildDayOfWeek is Monday-first and omits combinations that never happened', () => {
  const rows = buildDayOfWeek([
    e('2026-08-23', 'evening', 1, 1),  // Sunday
    e('2026-08-24', 'morning', 1, 1),  // Monday
  ])
  assert.deepEqual(rows.map((r) => r.day_of_week), ['Monday', 'Sunday'])
  assert.equal(rows.length, 2) // no empty rows for the other five days
})

test('buildTrend totals per day, oldest first', () => {
  const trend = buildTrend([
    e('2026-08-24', 'morning', 3, 1),
    e('2026-08-24', 'evening', 9, 9),
    e('2026-08-23', 'evening', 2, 0),
  ])
  assert.deepEqual(trend.map((d) => d.date), ['2026-08-23', '2026-08-24'])
  assert.equal(trend[1].total, 22)
  assert.equal(trend[1].under1, 10)
})

test('buildTotals counts blocks, days and corrections', () => {
  const totals = buildTotals([
    e('2026-08-24', 'morning', 3, 1),
    e('2026-08-24', 'evening', 9, 9, { submissions: 2 }),
  ])
  assert.equal(totals.blocks_reported, 2)
  assert.equal(totals.days_reported, 1)
  assert.equal(totals.corrections, 1)
  assert.equal(totals.over1.avg, 6)
})
