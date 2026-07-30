const test = require('node:test')
const assert = require('node:assert')
const { expandSeries, MAX_OCCURRENCES } = require('./groupXSeries')

const base = { weekdays: [1, 3, 5], start_time: '06:00', starts_on: '2026-08-03', ends_on: '2026-08-14' }

test('expandSeries emits one occurrence per matching weekday', () => {
  // Aug 3 2026 is a Monday. Mon/Wed/Fri over two weeks = 6.
  assert.deepStrictEqual(expandSeries(base).map(o => o.date), [
    '2026-08-03', '2026-08-05', '2026-08-07',
    '2026-08-10', '2026-08-12', '2026-08-14',
  ])
})

test('expandSeries builds ABC-shaped local timestamps', () => {
  assert.strictEqual(expandSeries(base)[0].timestamp_local, '2026-08-03 06:00:00')
})

test('ends_on is inclusive', () => {
  const out = expandSeries({ ...base, weekdays: [5], starts_on: '2026-08-14', ends_on: '2026-08-14' })
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].date, '2026-08-14')
})

test('a range with no matching weekday yields nothing', () => {
  assert.deepStrictEqual(expandSeries({ ...base, weekdays: [0], starts_on: '2026-08-03', ends_on: '2026-08-07' }), [])
})

test('expansion spans a DST boundary without drifting the local time', () => {
  // DST ends Nov 1 2026. The class must stay at 06:00 local on both sides —
  // this is the whole reason we re-attach wall time instead of converting.
  const out = expandSeries({ weekdays: [1], start_time: '06:00', starts_on: '2026-10-26', ends_on: '2026-11-09' })
  assert.deepStrictEqual(out.map(o => o.timestamp_local), [
    '2026-10-26 06:00:00', '2026-11-02 06:00:00', '2026-11-09 06:00:00',
  ])
})

test('expansion also holds across the spring DST boundary', () => {
  // DST starts Mar 8 2026.
  const out = expandSeries({ weekdays: [0], start_time: '17:30', starts_on: '2026-03-01', ends_on: '2026-03-15' })
  assert.deepStrictEqual(out.map(o => o.timestamp_local), [
    '2026-03-01 17:30:00', '2026-03-08 17:30:00', '2026-03-15 17:30:00',
  ])
})

test('expandSeries reports the real total when over the cap', () => {
  assert.throws(
    () => expandSeries({ weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: '06:00', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    /makes 365 classes, which is over the 200 limit/,
  )
})

test('expandSeries allows exactly the cap', () => {
  // 200 consecutive days, every weekday selected.
  const end = new Date(Date.UTC(2026, 0, 1))
  end.setUTCDate(end.getUTCDate() + 199)
  const iso = end.toISOString().slice(0, 10)
  const out = expandSeries({ weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: '06:00', starts_on: '2026-01-01', ends_on: iso })
  assert.strictEqual(out.length, MAX_OCCURRENCES)
})

test('expandSeries rejects an empty weekday set', () => {
  assert.throws(() => expandSeries({ ...base, weekdays: [] }), /at least one day/i)
})

test('expandSeries rejects an out-of-range weekday', () => {
  assert.throws(() => expandSeries({ ...base, weekdays: [7] }), /0-6/)
})

test('expandSeries rejects ends_on before starts_on', () => {
  assert.throws(() => expandSeries({ ...base, starts_on: '2026-08-14', ends_on: '2026-08-03' }), /end date/i)
})

test('expandSeries rejects a malformed time', () => {
  assert.throws(() => expandSeries({ ...base, start_time: '6am' }), /HH:mm/)
})

test('expandSeries handles a month-crossing range', () => {
  const out = expandSeries({ weekdays: [1], start_time: '06:00', starts_on: '2026-08-31', ends_on: '2026-09-14' })
  assert.deepStrictEqual(out.map(o => o.date), ['2026-08-31', '2026-09-07', '2026-09-14'])
})

test('MAX_OCCURRENCES is 200', () => {
  assert.strictEqual(MAX_OCCURRENCES, 200)
})
