const { test } = require('node:test')
const assert = require('node:assert')
const { parseHeadcount, attendanceRow, isoMinusDays } = require('./groupXAttendance')

test('parseHeadcount accepts whole numbers 0-500', () => {
  assert.deepStrictEqual(parseHeadcount(0), { headcount: 0 })
  assert.deepStrictEqual(parseHeadcount('12'), { headcount: 12 })
  assert.deepStrictEqual(parseHeadcount(500), { headcount: 500 })
})

test('parseHeadcount rejects junk', () => {
  for (const v of [undefined, null, '', '-1', '3.5', 'abc', '12abc']) {
    assert.ok(parseHeadcount(v).error, `expected error for ${JSON.stringify(v)}`)
  }
  assert.match(parseHeadcount(501).error, /looks wrong/)
})

test('attendanceRow builds the whole row', () => {
  const row = attendanceRow({
    clubNumber: 30935,
    eventId: 'e1',
    cls: {
      event_timestamp: '2026-09-15T17:00:00Z',
      event_timestamp_local: '2026-09-15 10:00:00',
      event_type_id: 't1',
      class_name: 'Spin',
      max_attendees: 0,
    },
    headcount: 9,
    recordedBy: 'Attendance link',
  })
  assert.strictEqual(row.club_number, '30935')
  assert.strictEqual(row.max_attendees, 0)
  assert.strictEqual(row.employee_id, null)
  assert.strictEqual(row.notes, null)
  assert.strictEqual(row.recorded_by, 'Attendance link')
})

test('isoMinusDays crosses month and year', () => {
  assert.strictEqual(isoMinusDays('2026-03-03', 7), '2026-02-24')
  assert.strictEqual(isoMinusDays('2026-01-02', 7), '2025-12-26')
})
