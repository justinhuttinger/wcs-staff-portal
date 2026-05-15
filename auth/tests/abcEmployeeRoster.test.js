const test = require('node:test')
const assert = require('node:assert/strict')

const { CLUBS, COLUMNS, toRow, sortByName } = require('../src/services/abcEmployeeRoster')

test('CLUBS lists the 7 expected WCS locations', () => {
  const slugs = CLUBS.map(c => c.slug).sort()
  assert.deepEqual(slugs, [
    'clackamas', 'eugene', 'keizer', 'medford', 'milwaukie', 'salem', 'springfield',
  ])
  // Every club must have a clubNumber so the ABC API can address it.
  for (const c of CLUBS) {
    assert.match(c.clubNumber, /^\d+$/, `club ${c.slug} needs a numeric clubNumber`)
    assert.ok(c.name, `club ${c.slug} needs a name`)
  }
})

test('COLUMNS includes Still Active? as the rightmost column', () => {
  assert.equal(COLUMNS.at(-1), 'Still Active?')
  assert.ok(COLUMNS.includes('First Name'))
  assert.ok(COLUMNS.includes('Last Name'))
  assert.ok(COLUMNS.includes('ABC Status'))
})

test('toRow flattens an ABC employee payload into the expected shape', () => {
  const row = toRow({
    employeeId: 'E-123',
    personal: { firstName: '  Jane  ', lastName: '  Doe ' },
    employment: { employeeStatus: 'active', position: 'Trainer', department: 'PT' },
  })
  assert.equal(row['Employee ID'], 'E-123')
  assert.equal(row['First Name'], 'Jane', 'leading/trailing whitespace trimmed')
  assert.equal(row['Last Name'], 'Doe')
  assert.equal(row['Position'], 'Trainer')
  assert.equal(row['Department'], 'PT')
  assert.equal(row['ABC Status'], 'active')
  assert.equal(row['Still Active?'], '', 'Still Active? must be blank for manager input')
})

test('toRow falls back to id when employeeId is missing and jobTitle when position is missing', () => {
  const row = toRow({
    id: 'fallback-1',
    personal: { firstName: 'A', lastName: 'B' },
    employment: { jobTitle: 'Front Desk' },
  })
  assert.equal(row['Employee ID'], 'fallback-1')
  assert.equal(row['Position'], 'Front Desk')
  assert.equal(row['ABC Status'], '', 'missing ABC status renders as empty string')
})

test('toRow tolerates missing personal/employment blocks', () => {
  const row = toRow({ employeeId: 'X' })
  assert.equal(row['Employee ID'], 'X')
  assert.equal(row['First Name'], '')
  assert.equal(row['Last Name'], '')
  assert.equal(row['Position'], '')
  assert.equal(row['Department'], '')
  assert.equal(row['ABC Status'], '')
})

test('sortByName sorts by Last Name then First Name', () => {
  const rows = [
    { 'Last Name': 'Smith', 'First Name': 'Bob' },
    { 'Last Name': 'Doe', 'First Name': 'Jane' },
    { 'Last Name': 'Smith', 'First Name': 'Alice' },
    { 'Last Name': 'Doe', 'First Name': 'Bob' },
  ]
  const sorted = sortByName(rows)
  assert.deepEqual(sorted.map(r => `${r['Last Name']} ${r['First Name']}`), [
    'Doe Bob',
    'Doe Jane',
    'Smith Alice',
    'Smith Bob',
  ])
  // Original array must not be mutated
  assert.equal(rows[0]['Last Name'], 'Smith', 'sortByName should not mutate input')
})
