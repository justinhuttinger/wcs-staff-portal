const test = require('node:test')
const assert = require('node:assert')
const {
  OPEN_ENDED_HORIZON_DAYS, durationBetween, addMinutes, time12, timeRangeLabel, toMinutes,
} = require('./scheduleTimes')

test('durationBetween converts a start and end into minutes', () => {
  assert.strictEqual(durationBetween('06:00', '07:00'), 60)
  assert.strictEqual(durationBetween('09:30', '10:00'), 30)
  assert.strictEqual(durationBetween('05:45', '07:15'), 90)
})

test('durationBetween rejects an end at or before the start', () => {
  // Wrapping past midnight would quietly create a 23 hour event.
  assert.throws(() => durationBetween('07:00', '07:00'), /after the start/)
  assert.throws(() => durationBetween('07:00', '06:00'), /past midnight/)
})

test('durationBetween rejects malformed times', () => {
  assert.throws(() => durationBetween('6am', '07:00'), /start time must be HH:mm/)
  assert.throws(() => durationBetween('06:00', ''), /end time must be HH:mm/)
  assert.throws(() => durationBetween('06:00', '25:00'), /end time must be HH:mm/)
})

test('addMinutes rolls the hour correctly', () => {
  assert.strictEqual(addMinutes('06:00', 90), '07:30')
  assert.strictEqual(addMinutes('23:00', 30), '23:30')
})

test('addMinutes clamps rather than spilling into the next day', () => {
  // A spilled end time would land the event on the wrong board column.
  assert.strictEqual(addMinutes('23:30', 120), '23:59')
})

test('time12 formats noon and midnight the way people read them', () => {
  assert.strictEqual(time12('12:00'), '12:00 PM')
  assert.strictEqual(time12('00:30'), '12:30 AM')
  assert.strictEqual(time12('13:05'), '1:05 PM')
})

test('timeRangeLabel drops the repeated meridiem within one half of the day', () => {
  // Saves real width in a TV column.
  assert.strictEqual(timeRangeLabel('06:00', 60), '6:00 - 7:00 AM')
  assert.strictEqual(timeRangeLabel('13:00', 60), '1:00 - 2:00 PM')
})

test('timeRangeLabel keeps both when the range crosses midday', () => {
  assert.strictEqual(timeRangeLabel('11:30', 60), '11:30 AM - 12:30 PM')
})

test('timeRangeLabel falls back to the start alone on bad input', () => {
  assert.strictEqual(timeRangeLabel('nonsense', 60), null)
})

test('toMinutes handles an HH:mm:ss value', () => {
  assert.strictEqual(toMinutes('06:30:00'), 390)
})

test('the open-ended horizon is far enough ahead to outrun the board', () => {
  // The board looks 7 days out; 90 gives the nightly top-up plenty of slack.
  assert.ok(OPEN_ENDED_HORIZON_DAYS >= 30)
})
