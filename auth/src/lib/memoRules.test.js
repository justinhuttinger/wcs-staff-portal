const test = require('node:test')
const assert = require('node:assert')
const {
  monthKey, pickLiveMemo, composeMemo, memoPlan, fullMemoPlan, noteStatus, notesSummary, cleanNotes, clubStatus, editionStatus, parseDates, canEditClub, cleanText,
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
const item = (id, starts_at, ends_at = null) => ({ id, title: id, description: 'x', published: true, starts_at, ends_at })
const note = (id, edition_id, starts_at, ends_at = null) => ({ id: `row-${id}`, edition_id, status: 'published', items: [item(id, starts_at, ends_at)] })
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

test('each note in a month keeps its own dates', () => {
  const row = { id: 'r', edition_id: 'nov', status: 'published', items: [
    item('short', '2026-11-01T00:00:00Z', '2026-11-15T00:00:00Z'),
    item('long', '2026-11-01T00:00:00Z', '2027-01-15T00:00:00Z'),
    item('later', '2026-11-20T00:00:00Z'),
  ] }
  assert.deepStrictEqual(composeMemo([NOV], [row], new Date('2026-11-10T00:00:00Z')).note_ids, ['short', 'long'])
  assert.deepStrictEqual(composeMemo([NOV], [row], new Date('2026-11-25T00:00:00Z')).note_ids, ['long', 'later'])
  assert.deepStrictEqual(composeMemo([NOV, DEC], [row], new Date('2026-12-20T00:00:00Z')).note_ids, ['long'])
})

test('the plan follows each note, and only title and description reach the memo', () => {
  const row = { id: 'r', edition_id: 'nov', status: 'published', items: [
    item('a', '2026-11-01T00:00:00Z', '2026-11-15T00:00:00Z'),
    item('b', '2026-11-01T00:00:00Z'),
  ] }
  const plan = memoPlan([NOV], [row], new Date('2026-11-10T00:00:00Z'))
  assert.deepStrictEqual(plan.map(m => m.key), ['nov~a.b', 'nov~b'])
  assert.deepStrictEqual(plan[1].club_items, [{ title: 'b', description: 'x' }])
})

test('an unpublished note does not show, even in a published row', () => {
  const row = { id: 'r', edition_id: 'nov', status: 'published', items: [{ ...item('a', '2026-11-01T00:00:00Z'), published: false }] }
  assert.deepStrictEqual(composeMemo([NOV], [row], new Date('2026-11-10T00:00:00Z')).note_ids, [])
})

test('note states', () => {
  const at = new Date('2026-11-10T00:00:00Z')
  const m = '2026-11-01'
  assert.strictEqual(noteStatus({ published: false }, m, m, at), 'draft')
  assert.strictEqual(noteStatus(item('a', '2026-12-01T00:00:00Z'), m, m, at), 'scheduled')
  assert.strictEqual(noteStatus(item('a', '2026-11-01T00:00:00Z'), m, m, at), 'live')
  assert.strictEqual(noteStatus(item('a', '2026-11-01T00:00:00Z', '2026-11-05T00:00:00Z'), m, m, at), 'ended')
  assert.strictEqual(noteStatus(item('a', '2026-10-01T00:00:00Z'), '2026-10-01', m, at), 'replaced')
  assert.strictEqual(notesSummary({ items: [] }, m, m, at), 'not_started')
  assert.strictEqual(notesSummary({ items: [item('a', '2026-11-01T00:00:00Z'), { published: false }] }, m, m, at), 'live')
})

test('cleanNotes keeps saved ids and published flags and ignores made-up ones', () => {
  const saved = [{ id: 'a', published: true }]
  const { notes } = cleanNotes([
    { id: 'a', title: 'T', description: 'D', state: 'live' },
    { id: 'fake', title: 'New', description: 'D', published: true },
    { title: '', description: '' },
  ], saved)
  assert.strictEqual(notes.length, 2)
  assert.deepStrictEqual(Object.keys(notes[0]).sort(), ['description', 'ends_at', 'id', 'published', 'starts_at', 'title'])
  assert.strictEqual(notes[0].id, 'a')
  assert.strictEqual(notes[0].published, true)
  assert.notStrictEqual(notes[1].id, 'fake')
  assert.strictEqual(notes[1].published, false)
})

test('cleanNotes refuses bad dates', () => {
  assert.match(cleanNotes([{ title: 'T', description: 'D', starts_at: 'nope' }]).error, /Invalid date/)
  assert.match(cleanNotes([{ title: 'T', description: 'D', starts_at: '2026-11-02T00:00:00Z', ends_at: '2026-11-01T00:00:00Z' }]).error, /end date/)
})

test('the full plan can be longer than what gets drawn', () => {
  const items = Array.from({ length: 20 }, (_, i) => item(`n${i}`, new Date(Date.UTC(2026, 11, i + 1)).toISOString()))
  const row = { id: 'r', edition_id: 'nov', status: 'published', items }
  const at = new Date('2026-11-10T00:00:00Z')
  assert.strictEqual(memoPlan([NOV], [row], at).length, 12)
  assert.ok(fullMemoPlan([NOV], [row], at).length > 12)
})

test('clearing a published note start keeps it up', () => {
  const saved = [{ id: 'a', published: true, starts_at: '2026-11-01T00:00:00.000Z' }]
  const { notes } = cleanNotes([{ id: 'a', title: 'T', description: 'D', starts_at: null }], saved)
  assert.strictEqual(notes[0].starts_at, '2026-11-01T00:00:00.000Z')
})
