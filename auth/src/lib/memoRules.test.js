const test = require('node:test')
const assert = require('node:assert')
const {
  monthKey, pickLiveMemo, composeMemo, memoPlan, clubStatus, editionStatus, parseDates, canEditClub, cleanText,
  cleanItems, itemsError, monthOptions, currentMonth,
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

test('cleanText trims, enforces the cap and treats non-strings as empty', () => {
  assert.strictEqual(cleanText('  hi  ', 10), 'hi')
  assert.strictEqual(cleanText('abcdef', 3), 'abc')
  assert.strictEqual(cleanText(5, 10), '')
})

test('cleanItems trims, drops empty rows, keeps half-written ones and ignores junk', () => {
  assert.deepStrictEqual(cleanItems([
    { title: ' A ', description: ' B ', extra: 'x' },
    { title: '', description: '  ' },
    { title: 'Only title' },
  ]), [{ title: 'A', description: 'B' }, { title: 'Only title', description: '' }])
  assert.deepStrictEqual(cleanItems('nope'), [])
})

test('itemsError requires both a title and a description', () => {
  assert.strictEqual(itemsError([{ title: 'A', description: 'B' }]), null)
  assert.ok(itemsError([{ title: 'A', description: '' }]))
  assert.ok(itemsError([{ title: '', description: 'B' }]))
  assert.strictEqual(itemsError([]), null)
  assert.strictEqual(itemsError(undefined), null)
})

test('monthOptions always offers this month and the next three, plus anything written', () => {
  const now = new Date('2026-11-15T12:00:00Z')
  assert.deepStrictEqual(monthOptions(['2026-08-01', '2026-11-01'], now),
    ['2027-02-01', '2027-01-01', '2026-12-01', '2026-11-01', '2026-08-01'])
})

test('the current month is Pacific, not UTC, at a month boundary', () => {
  assert.strictEqual(currentMonth(new Date('2026-12-01T03:00:00Z')), '2026-11-01')
})

const ed = (id, month, starts_at, ends_at = null, status = 'ready') => ({ id, month, status, items: [{ title: id, description: 'x' }], starts_at, ends_at })
const note = (id, edition_id, starts_at, ends_at = null) => ({ id, edition_id, status: 'published', items: [{ title: id, description: 'x' }], starts_at, ends_at })
const NOV = ed('nov', '2026-11-01', '2026-11-01T00:00:00Z')
const DEC = ed('dec', '2026-12-01', '2026-12-01T00:00:00Z')

test('Main shows without the club publishing anything', () => {
  const memo = composeMemo([NOV], [], new Date('2026-11-10T00:00:00Z'))
  assert.strictEqual(memo.month, '2026-11-01')
  assert.deepStrictEqual(memo.main_items, NOV.items)
  assert.deepStrictEqual(memo.club_items, [])
})

test('a draft or future Main does not show', () => {
  const at = new Date('2026-11-10T00:00:00Z')
  assert.strictEqual(composeMemo([ed('d', '2026-11-01', null, null, 'draft')], [], at), null)
  assert.strictEqual(composeMemo([DEC], [], at), null)
})

test('notes with an end date run into the next month', () => {
  const memo = composeMemo([NOV, DEC], [note('a', 'nov', '2026-11-05T00:00:00Z', '2027-01-15T00:00:00Z')], new Date('2026-12-20T00:00:00Z'))
  assert.strictEqual(memo.month, '2026-12-01')
  assert.deepStrictEqual(memo.note_ids, ['a'])
})

test('notes with no end date stop when a later Main starts', () => {
  const notes = [note('a', 'nov', '2026-11-05T00:00:00Z')]
  assert.deepStrictEqual(composeMemo([NOV, DEC], notes, new Date('2026-11-20T00:00:00Z')).note_ids, ['a'])
  assert.deepStrictEqual(composeMemo([NOV, DEC], notes, new Date('2026-12-02T00:00:00Z')).note_ids, [])
})

test('two sets of notes show together, newest month first', () => {
  const notes = [note('old', 'nov', '2026-11-05T00:00:00Z', '2027-01-15T00:00:00Z'), note('new', 'dec', '2026-12-05T00:00:00Z')]
  assert.deepStrictEqual(composeMemo([NOV, DEC], notes, new Date('2026-12-20T00:00:00Z')).note_ids, ['new', 'old'])
})

test('notes can show with no Main live', () => {
  const memo = composeMemo([], [], new Date('2026-11-10T00:00:00Z'))
  assert.strictEqual(memo, null)
  const alone = composeMemo([ed('d', '2026-11-01', null, null, 'draft')], [note('a', 'd', '2026-11-05T00:00:00Z')], new Date('2026-11-10T00:00:00Z'))
  assert.strictEqual(alone.month, '2026-11-01')
  assert.deepStrictEqual(alone.main_items, [])
})

test('published notes with no items add nothing', () => {
  const empty = { ...note('a', 'nov', '2026-11-05T00:00:00Z'), items: [] }
  assert.deepStrictEqual(composeMemo([NOV], [empty], new Date('2026-11-10T00:00:00Z')).note_ids, [])
})

test('the plan has an image for each change ahead, including after notes end', () => {
  const notes = [note('a', 'nov', '2026-11-05T00:00:00Z', '2026-12-15T00:00:00Z')]
  const plan = memoPlan([NOV, DEC], notes, new Date('2026-11-10T00:00:00Z'))
  assert.deepStrictEqual(plan.map(m => m.key), ['nov~a', 'dec~a', 'dec~'])
})

test('the plan is empty when nothing is live or coming', () => {
  assert.deepStrictEqual(memoPlan([], [], new Date('2026-11-10T00:00:00Z')), [])
})

test('Main states', () => {
  const at = new Date('2026-11-10T00:00:00Z')
  assert.strictEqual(editionStatus({ status: 'draft' }, null, at), 'draft')
  assert.strictEqual(editionStatus(DEC, null, at), 'scheduled')
  assert.strictEqual(editionStatus(NOV, 'nov', at), 'live')
  assert.strictEqual(editionStatus(ed('oct', '2026-10-01', '2026-10-01T00:00:00Z'), 'nov', at), 'replaced')
})
