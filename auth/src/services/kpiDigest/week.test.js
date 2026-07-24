// auth/src/services/kpiDigest/week.test.js
const test = require('node:test')
const assert = require('node:assert')
const { priorWeek, addDays } = require('./week')

// The offset Justin corrected: a Monday-the-20th run reports 13th–19th.
test('Monday run reports the week that ended the day before', () => {
  // 2026-07-20 is a Monday. Pacific-afternoon instant so the UTC timestamp
  // still reads as the 20th in Los Angeles.
  assert.deepStrictEqual(
    priorWeek(new Date('2026-07-20T15:00:00Z')),
    { start: '2026-07-13', end: '2026-07-19' },
  )
})

test('a run later in the same week still reports the prior completed week', () => {
  // Thursday 2026-07-23 -> most recent Monday is the 20th -> same window.
  assert.deepStrictEqual(
    priorWeek(new Date('2026-07-23T15:00:00Z')),
    { start: '2026-07-13', end: '2026-07-19' },
  )
})

test('Sunday run reports the prior completed week, not the in-progress one', () => {
  // Sunday 2026-07-26 -> most recent Monday on-or-before is the 20th.
  assert.deepStrictEqual(
    priorWeek(new Date('2026-07-26T15:00:00Z')),
    { start: '2026-07-13', end: '2026-07-19' },
  )
})

test('window is always Monday start, Sunday end, 7 days inclusive', () => {
  for (const iso of ['2026-01-05T15:00:00Z', '2026-03-09T20:00:00Z', '2026-12-28T18:00:00Z']) {
    const w = priorWeek(new Date(iso))
    assert.strictEqual(addDays(w.start, 6), w.end)
    assert.strictEqual(addDays(w.start, 7), addDays(w.end, 1))
  }
})

test('crossing a month boundary stays calendar-correct', () => {
  // Monday 2026-08-03 -> prior week is 2026-07-27 .. 2026-08-02.
  assert.deepStrictEqual(
    priorWeek(new Date('2026-08-03T15:00:00Z')),
    { start: '2026-07-27', end: '2026-08-02' },
  )
})

test('addDays handles month and year rollover', () => {
  assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01')
  assert.strictEqual(addDays('2026-03-01', -1), '2026-02-28')
})
