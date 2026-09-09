const test = require('node:test')
const assert = require('node:assert')
const { formatPacific, passEndDate } = require('./humanTime')

test('renders a UTC instant on the club clock', () => {
  // 23:05 UTC on 9 Sep is 4:05pm Pacific the same day.
  assert.strictEqual(formatPacific('2026-09-09T23:05:51.004Z'), '09/09/2026 | 4:05 PM')
})

test('rolls back to the previous day when UTC has already ticked over', () => {
  // The case that makes a naive UTC render wrong: 00:30 UTC on the 10th is
  // still 5:30pm on the 9th at the front desk.
  assert.strictEqual(formatPacific('2026-09-10T00:30:00Z'), '09/09/2026 | 5:30 PM')
})

test('follows Pacific daylight saving rather than a fixed offset', () => {
  // January is PST (-8).
  assert.strictEqual(formatPacific('2026-01-15T20:00:00Z'), '01/15/2026 | 12:00 PM')
  // July is PDT (-7), so the same UTC clock reads an hour later.
  assert.strictEqual(formatPacific('2026-07-15T20:00:00Z'), '07/15/2026 | 1:00 PM')
})

test('pads the date but not the hour', () => {
  assert.strictEqual(formatPacific('2026-03-04T17:07:00Z'), '03/04/2026 | 9:07 AM')
})

test('renders midnight and noon the way a person says them', () => {
  assert.strictEqual(formatPacific('2026-09-09T07:00:00Z'), '09/09/2026 | 12:00 AM')
  assert.strictEqual(formatPacific('2026-09-09T19:00:00Z'), '09/09/2026 | 12:00 PM')
})

test('accepts a Date as well as a string', () => {
  assert.strictEqual(formatPacific(new Date('2026-09-09T23:05:00Z')), '09/09/2026 | 4:05 PM')
})

test('yields null for anything that is not an instant', () => {
  for (const bad of [null, undefined, '', 'not a date', NaN]) {
    assert.strictEqual(formatPacific(bad), null, `expected null for ${String(bad)}`)
  }
})

test('a pass ends N days after the club day it started', () => {
  // 23:05 UTC on 9 Sep is still the 9th at the club, so a 14-day pass runs to
  // the 23rd.
  assert.strictEqual(passEndDate('2026-09-09T23:05:51.004Z', 14), '09-23-2026')
})

test('counts from the club day, not the UTC one', () => {
  // 00:30 UTC on the 10th is the evening of the 9th in Pacific. Counting from
  // the UTC date would hand out an extra day.
  assert.strictEqual(passEndDate('2026-09-10T00:30:00Z', 7), '09-16-2026')
})

test('crosses month and year boundaries', () => {
  assert.strictEqual(passEndDate('2026-01-25T20:00:00Z', 10), '02-04-2026')
  assert.strictEqual(passEndDate('2026-12-28T20:00:00Z', 7), '01-04-2027')
})

test('survives a daylight-saving change mid-pass', () => {
  // 1 Nov 2026 is PDT, 8 Nov is PST. A fixed-offset calculation slips a day.
  assert.strictEqual(passEndDate('2026-11-01T18:00:00Z', 14), '11-15-2026')
})

test('accepts the day count as a string, as a DB row supplies it', () => {
  assert.strictEqual(passEndDate('2026-09-09T23:05:00Z', '14'), '09-23-2026')
})

test('yields null when the outcome granted no pass', () => {
  for (const none of [null, undefined, 0, '', 'abc', -5]) {
    assert.strictEqual(passEndDate('2026-09-09T23:05:00Z', none), null,
      `expected null for ${String(none)} days`)
  }
})

test('yields null when the start is not a real instant', () => {
  assert.strictEqual(passEndDate('not a date', 14), null)
})
