const test = require('node:test')
const assert = require('node:assert')
const { isDstPacific, parseAbcTs, padDate, toIsoDate, buildLocalTimestamp } = require('./abcTime')

test('parseAbcTs converts a PDT summer timestamp to UTC', () => {
  // 2026-07-28 10:00 Pacific (PDT, -07:00) === 17:00 UTC
  const r = parseAbcTs('2026-07-28 10:00:00.000000')
  assert.strictEqual(r.utc, '2026-07-28T17:00:00.000Z')
  assert.strictEqual(r.local, '2026-07-28 10:00:00')
})

test('parseAbcTs converts a PST winter timestamp to UTC', () => {
  // 2026-01-15 10:00 Pacific (PST, -08:00) === 18:00 UTC
  const r = parseAbcTs('2026-01-15 10:00:00.000000')
  assert.strictEqual(r.utc, '2026-01-15T18:00:00.000Z')
})

test('parseAbcTs accepts the ISO T separator ABC sometimes returns', () => {
  const r = parseAbcTs('2026-07-28T10:00:00.000000')
  assert.strictEqual(r.utc, '2026-07-28T17:00:00.000Z')
})

test('parseAbcTs returns nulls for empty input', () => {
  assert.deepStrictEqual(parseAbcTs(null), { utc: null, local: null })
  assert.deepStrictEqual(parseAbcTs(''), { utc: null, local: null })
})

test('isDstPacific brackets the 2026 DST transitions', () => {
  // DST 2026: starts Mar 8, ends Nov 1.
  assert.strictEqual(isDstPacific(new Date('2026-03-07T12:00:00Z')), false)
  assert.strictEqual(isDstPacific(new Date('2026-03-09T12:00:00Z')), true)
  assert.strictEqual(isDstPacific(new Date('2026-10-31T12:00:00Z')), true)
  assert.strictEqual(isDstPacific(new Date('2026-11-02T12:00:00Z')), false)
})

test('padDate shifts a date string and crosses month boundaries', () => {
  assert.strictEqual(padDate('2026-07-28', 1), '2026-07-29')
  assert.strictEqual(padDate('2026-08-01', -1), '2026-07-31')
  assert.strictEqual(padDate('2026-01-01', -1), '2025-12-31')
})

test('toIsoDate formats a Date as UTC YYYY-MM-DD', () => {
  assert.strictEqual(toIsoDate(new Date('2026-07-28T23:30:00Z')), '2026-07-28')
})

test('buildLocalTimestamp joins date and HH:mm into an ABC timestamp', () => {
  assert.strictEqual(buildLocalTimestamp('2026-08-03', '06:00'), '2026-08-03 06:00:00')
})

test('buildLocalTimestamp accepts HH:mm:ss unchanged', () => {
  assert.strictEqual(buildLocalTimestamp('2026-08-03', '06:30:00'), '2026-08-03 06:30:00')
})

test('buildLocalTimestamp keeps a late evening time in 24-hour form', () => {
  assert.strictEqual(buildLocalTimestamp('2026-08-03', '19:45'), '2026-08-03 19:45:00')
})

test('buildLocalTimestamp rejects a malformed time', () => {
  assert.throws(() => buildLocalTimestamp('2026-08-03', '6am'), /invalid time/i)
  assert.throws(() => buildLocalTimestamp('2026-08-03', '25:00'), /invalid time/i)
  assert.throws(() => buildLocalTimestamp('2026-08-03', ''), /invalid time/i)
})

test('buildLocalTimestamp rejects a malformed date', () => {
  assert.throws(() => buildLocalTimestamp('08/03/2026', '06:00'), /invalid date/i)
  assert.throws(() => buildLocalTimestamp('', '06:00'), /invalid date/i)
})
