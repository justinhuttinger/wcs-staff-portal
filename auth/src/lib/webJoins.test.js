const test = require('node:test')
const assert = require('node:assert')
const { buildWebJoins, isWebSource, monthsBetween, monthsBack } = require('./webJoins')

const clubs = [
  { clubNumber: '1', name: 'Salem' },
  { clubNumber: '2', name: 'Keizer' },
  { clubNumber: '3', name: 'Empty' },
]

const rows = [
  { club_number: '1', since_date: '2026-08-10', agreement_entry_source: 'Web' },
  { club_number: '1', since_date: '2026-09-02', agreement_entry_source: 'Web' },
  { club_number: '1', since_date: '2026-09-03', agreement_entry_source: 'DataTrak EAE' },
  { club_number: '2', since_date: '2026-09-04', agreement_entry_source: 'web ' },
  { club_number: '2', since_date: '2026-09-05', agreement_entry_source: null },
  { club_number: '2', since_date: '2026-09-06', agreement_entry_source: 'Transfer' },
]

test('isWebSource is case and whitespace tolerant, rejects everything else', () => {
  assert.equal(isWebSource('Web'), true)
  assert.equal(isWebSource(' web '), true)
  assert.equal(isWebSource('DataTrak EAE'), false)
  assert.equal(isWebSource(null), false)
})

test('month helpers', () => {
  assert.deepEqual(monthsBetween('2025-11-15', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02'])
  assert.equal(monthsBack('2026-02-20', 12), '2025-02-01')
  assert.equal(monthsBack('2026-09-28', 0), '2026-09-01')
})

test('range summary counts only joins inside start..end', () => {
  const out = buildWebJoins(rows, { start: '2026-09-01', end: '2026-09-28', trendStart: '2026-08-01', clubs })
  assert.deepEqual(out.summary, { total: 5, web: 2, inClub: 3, webPct: 40 })
})

test('byClub drops empty clubs and ranks by web share', () => {
  const out = buildWebJoins(rows, { start: '2026-09-01', end: '2026-09-28', trendStart: '2026-08-01', clubs })
  assert.deepEqual(out.byClub.map(c => [c.label, c.web, c.total]), [['Salem', 1, 2], ['Keizer', 1, 3]])
})

test('monthly trend flags a partial last month', () => {
  const out = buildWebJoins(rows, { start: '2026-09-01', end: '2026-09-28', trendStart: '2026-08-01', clubs })
  assert.deepEqual(out.months.map(m => [m.month, m.total, m.web, m.partial]), [
    ['2026-08', 1, 1, false],
    ['2026-09', 5, 2, true],
  ])
  const full = buildWebJoins(rows, { start: '2026-08-01', end: '2026-08-31', trendStart: '2026-08-01', clubs })
  assert.equal(full.months[0].partial, false)
})

test('no joins gives a null share, not zero', () => {
  const out = buildWebJoins([], { start: '2026-09-01', end: '2026-09-28', trendStart: '2026-09-01', clubs })
  assert.equal(out.summary.webPct, null)
  assert.equal(out.byClub.length, 0)
})
