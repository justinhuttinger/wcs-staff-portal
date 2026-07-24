// auth/src/services/meetingNotes/dates.test.js
const test = require('node:test')
const assert = require('node:assert')
const { addDays, todayPacific } = require('./dates')

test('addDays handles week + month + year rollover', () => {
  assert.strictEqual(addDays('2026-07-20', 7), '2026-07-27')
  assert.strictEqual(addDays('2026-12-29', 7), '2027-01-05')
  assert.strictEqual(addDays('2026-03-01', -1), '2026-02-28')
})

test('todayPacific returns a YYYY-MM-DD string in Pacific', () => {
  // A UTC instant just after midnight UTC is still the previous day in Pacific.
  const d = todayPacific(new Date('2026-07-21T05:00:00Z')) // 10pm Jul 20 PDT
  assert.strictEqual(d, '2026-07-20')
})

test('recency cutoff math: 21-day window excludes older, includes newer', () => {
  const cutoff = addDays(todayPacific(new Date('2026-07-24T20:00:00Z')), -21)
  assert.strictEqual(cutoff, '2026-07-03')
  // A meeting dated 2026-07-13 is inside the window; 2026-06-30 is outside.
  assert.ok('2026-07-13' >= cutoff)
  assert.ok(!('2026-06-30' >= cutoff))
})
