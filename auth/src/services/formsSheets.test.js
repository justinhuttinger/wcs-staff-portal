const test = require('node:test')
const assert = require('node:assert')
const { computeColumns, buildHeaderRow, buildRowValues, pacificTimestamp } = require('./formsSheets')

const SCHEMA = [
  { id: 'f_h', type: 'header', label: 'Welcome' },
  { id: 'f_name', type: 'short_text', label: 'Name' },
  { id: 'f_days', type: 'checkbox', label: 'Days', options: ['Sat', 'Sun'] },
]

test('computeColumns: first pass assigns 2..N in schema order, skips display blocks', () => {
  const cols = computeColumns(SCHEMA, {})
  assert.deepStrictEqual(cols, { f_name: 2, f_days: 3 })
})

test('computeColumns: existing mappings never move; new fields append after max', () => {
  const existing = { f_name: 2, f_days: 3 }
  const grown = [...SCHEMA, { id: 'f_email', type: 'email', label: 'Email' }]
  assert.deepStrictEqual(computeColumns(grown, existing), { f_name: 2, f_days: 3, f_email: 4 })
  // removed field keeps its column reserved
  const shrunk = [SCHEMA[0], SCHEMA[2], { id: 'f_new', type: 'date', label: 'Date' }]
  assert.deepStrictEqual(computeColumns(shrunk, existing), { f_name: 2, f_days: 3, f_new: 4 })
})

test('buildHeaderRow: Submitted At first, labels at their columns', () => {
  const cols = { f_name: 2, f_days: 3 }
  assert.deepStrictEqual(buildHeaderRow(SCHEMA, cols), ['Submitted At', 'Name', 'Days'])
})

test('buildRowValues: dense row, checkbox joined, blanks for missing', () => {
  const cols = { f_name: 2, f_days: 3, f_gone: 4 }
  const row = buildRowValues(cols, { f_name: 'Justin', f_days: ['Sat', 'Sun'] }, '07/08/2026 09:00:00')
  assert.deepStrictEqual(row, ['07/08/2026 09:00:00', 'Justin', 'Sat, Sun', ''])
})

test('pacificTimestamp formats a fixed instant in America/Los_Angeles', () => {
  const s = pacificTimestamp(new Date('2026-07-08T20:05:33Z'))
  assert.match(s, /^07\/08\/2026 13:05:33$/)
})
