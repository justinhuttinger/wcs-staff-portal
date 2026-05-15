const test = require('node:test')
const assert = require('node:assert/strict')

const { buildMtdMonthWindows } = require('../src/services/revenueMtdWindows')

test('buildMtdMonthWindows: 12 buckets oldest-first', () => {
  const months = buildMtdMonthWindows('2026-05-15', 12)
  assert.equal(months.length, 12)
  // Oldest first
  assert.ok(months[0].month < months[months.length - 1].month, 'sorted oldest → newest')
  assert.equal(months[months.length - 1].month, '2026-05')
  assert.equal(months[0].month, '2025-06')
})

test('buildMtdMonthWindows: cutoff day-of-month is preserved when month is long enough', () => {
  const months = buildMtdMonthWindows('2026-05-15', 12)
  for (const m of months) {
    const expectedDay = m.month === '2026-02' || m.month === '2025-06' ? null : '15'
    if (expectedDay) {
      assert.equal(m.period_end.slice(-2), expectedDay, `${m.month} should end on the 15th`)
    }
    assert.equal(m.period_start.slice(-2), '01', `${m.month} starts on the 1st`)
  }
})

test('buildMtdMonthWindows: caps cutoff day to the last day of shorter months', () => {
  // Asking for "MTD as of the 31st" through 12 months means February (28 or 29
  // days) and the 30-day months must cap to their actual last day.
  const months = buildMtdMonthWindows('2026-05-31', 12)
  const feb = months.find(m => m.month === '2026-02')
  assert.ok(feb, 'February bucket must exist')
  // 2026 isn't a leap year → February has 28 days
  assert.equal(feb.period_end, '2026-02-28')

  const apr = months.find(m => m.month === '2026-04')
  assert.equal(apr.period_end, '2026-04-30', 'April caps at the 30th')

  const may = months.find(m => m.month === '2026-05')
  assert.equal(may.period_end, '2026-05-31', '31-day month keeps the 31st')
})

test('buildMtdMonthWindows: handles February in a leap year', () => {
  const months = buildMtdMonthWindows('2024-02-29', 1)
  assert.equal(months.length, 1)
  assert.equal(months[0].month, '2024-02')
  assert.equal(months[0].period_end, '2024-02-29')
})

test('buildMtdMonthWindows: walks back across year boundaries', () => {
  const months = buildMtdMonthWindows('2026-01-15', 6)
  assert.deepEqual(months.map(m => m.month), [
    '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01',
  ])
})
