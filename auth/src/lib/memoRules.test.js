const test = require('node:test')
const assert = require('node:assert')
const {
  monthKey, pickLiveMemo, clubStatus, parseDates, canEditClub, canPublish, cleanText,
} = require('./memoRules')

const NOW = new Date('2026-11-15T12:00:00Z')
const memo = (id, starts_at, ends_at = null, status = 'published') => ({ id, status, starts_at, ends_at })

test('monthKey normalizes a month and rejects anything else', () => {
  assert.strictEqual(monthKey('2026-11'), '2026-11-01')
  assert.strictEqual(monthKey('2026-11-01'), '2026-11-01')
  assert.strictEqual(monthKey('2026-13'), null)
  assert.strictEqual(monthKey('nope'), null)
  assert.strictEqual(monthKey(null), null)
})

test('the newest started memo is live', () => {
  const live = pickLiveMemo([memo('oct', '2026-10-01T00:00:00Z'), memo('nov', '2026-11-01T00:00:00Z')], NOW)
  assert.strictEqual(live.id, 'nov')
})

test('an older open-ended memo never comes back when the newest has ended', () => {
  const live = pickLiveMemo([
    memo('oct', '2026-10-01T00:00:00Z'),
    memo('nov', '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'),
  ], NOW)
  assert.strictEqual(live, null)
})

test('a scheduled memo does not replace the live one before its start', () => {
  const live = pickLiveMemo([memo('nov', '2026-11-01T00:00:00Z'), memo('dec', '2026-12-01T00:00:00Z')], NOW)
  assert.strictEqual(live.id, 'nov')
})

test('drafts are never live', () => {
  assert.strictEqual(pickLiveMemo([memo('nov', '2026-11-01T00:00:00Z', null, 'draft')], NOW), null)
  assert.strictEqual(pickLiveMemo([], NOW), null)
})

test('clubStatus names every state', () => {
  assert.strictEqual(clubStatus(null, null, NOW), 'not_started')
  assert.strictEqual(clubStatus(memo('a', null, null, 'draft'), null, NOW), 'draft')
  assert.strictEqual(clubStatus(memo('a', '2026-12-01T00:00:00Z'), null, NOW), 'scheduled')
  assert.strictEqual(clubStatus(memo('a', '2026-11-01T00:00:00Z'), 'a', NOW), 'live')
  assert.strictEqual(clubStatus(memo('a', '2026-10-01T00:00:00Z', '2026-10-20T00:00:00Z'), null, NOW), 'ended')
  assert.strictEqual(clubStatus(memo('a', '2026-10-01T00:00:00Z'), 'b', NOW), 'replaced')
})

test('parseDates defaults the start to now and an empty end to "until the next one"', () => {
  assert.deepStrictEqual(parseDates({}, NOW), { starts_at: NOW.toISOString(), ends_at: null })
})

test('parseDates rejects bad dates and an end at or before the start', () => {
  assert.ok(parseDates({ starts_at: 'nope' }, NOW).error)
  assert.ok(parseDates({ ends_at: 'nope' }, NOW).error)
  assert.ok(parseDates({ starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' }, NOW).error)
  assert.ok(parseDates({ starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-11-01T00:00:00Z' }, NOW).error)
})

test('canEditClub limits a manager to their own clubs; null scope means every club', () => {
  assert.strictEqual(canEditClub(['salem'], 'salem'), true)
  assert.strictEqual(canEditClub(['salem'], 'keizer'), false)
  assert.strictEqual(canEditClub([], 'salem'), false)
  assert.strictEqual(canEditClub(null, 'salem'), true)
})

test('a club can only publish once the company section is ready', () => {
  assert.strictEqual(canPublish({ status: 'ready' }), true)
  assert.strictEqual(canPublish({ status: 'draft' }), false)
  assert.strictEqual(canPublish(null), false)
})

test('cleanText trims, enforces the cap and treats non-strings as empty', () => {
  assert.strictEqual(cleanText('  hi  ', 10), 'hi')
  assert.strictEqual(cleanText('abcdef', 3), 'abc')
  assert.strictEqual(cleanText(5, 10), '')
})
