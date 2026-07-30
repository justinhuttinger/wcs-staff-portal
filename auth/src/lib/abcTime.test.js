const test = require('node:test')
const assert = require('node:assert')
const { isDstPacific, parseAbcTs, padDate, toIsoDate } = require('./abcTime')

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
