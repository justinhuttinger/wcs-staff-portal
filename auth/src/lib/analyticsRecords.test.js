const test = require('node:test')
const assert = require('node:assert')
const {
  SETS, setKeys, clubNumbersFor, matchesPerson, groupSessionsIntoClients,
} = require('./analyticsRecords')
const { CLUBS, ACH_PAYMENT_METHOD } = require('./salespersonPerformance')

// ---------------------------------------------------------------------------
// The registry itself. A malformed set would render a modal with no columns or
// blank cells, which looks like missing data rather than a broken set.
// ---------------------------------------------------------------------------

test('every record set declares a label, columns and a loader', () => {
  for (const key of setKeys()) {
    const set = SETS[key]
    assert.ok(set.label, `${key} has no label`)
    assert.ok(Array.isArray(set.columns) && set.columns.length > 0, `${key} has no columns`)
    assert.equal(typeof set.load, 'function', `${key} has no loader`)
    for (const c of set.columns) {
      assert.ok(c.key, `${key} has a column with no key`)
      assert.ok(c.label, `${key}.${c.key} has no label`)
      assert.ok(['text', 'date', 'int', 'money', 'pct'].includes(c.format),
        `${key}.${c.key} has an unrenderable format: ${c.format}`)
    }
  }
})

// Every drill-down in the two snapshots names one of these. A rename that broke
// a call site would otherwise show up as a 400 the first time somebody clicked.
test('the sets the snapshots drill into all exist', () => {
  for (const key of [
    'pt-sessions', 'pt-clients', 'pt-sales', 'pt-losses',
    'day-ones', 'day-ones-pending', 'new-members', 'vips', 'tours',
  ]) {
    assert.ok(SETS[key], `missing set: ${key}`)
  }
})

// ---------------------------------------------------------------------------
// Club scoping.
// ---------------------------------------------------------------------------

test('asking for every club scopes to none, so the query stays unfiltered', () => {
  assert.equal(clubNumbersFor(CLUBS.map(c => c.slug)), null)
  assert.equal(clubNumbersFor([]), null)
  assert.equal(clubNumbersFor(null), null)
})

test('a subset of clubs resolves to their ABC numbers', () => {
  const out = clubNumbersFor(['salem', 'keizer'])
  assert.equal(out.length, 2)
  assert.ok(out.every(n => typeof n === 'string' && n.length > 0))
})

// ---------------------------------------------------------------------------
// Person matching — the same normalisation the reports group people on, or a
// drill-down opens somebody else's list.
// ---------------------------------------------------------------------------

test('no person asked for means everybody', () => {
  assert.equal(matchesPerson('Katie Castlio', null), true)
  assert.equal(matchesPerson(null, null), true)
})

test('inner whitespace and case do not split one person in two', () => {
  assert.equal(matchesPerson('Katie  Castlio', 'katie castlio'), true)
  assert.equal(matchesPerson('  KATIE CASTLIO ', 'Katie Castlio'), true)
})

test('a different person does not match', () => {
  assert.equal(matchesPerson('Katie Castlio', 'Tom Anderson'), false)
})

// A row with no name on it belongs to nobody, and must not fall into the list
// of whoever happens to be selected.
test('an unnamed row matches nobody once a person is asked for', () => {
  assert.equal(matchesPerson(null, 'Katie Castlio'), false)
  assert.equal(matchesPerson('   ', 'Katie Castlio'), false)
})

// ---------------------------------------------------------------------------
// Sessions folded into clients.
// ---------------------------------------------------------------------------

const session = (over = {}) => ({
  member: 'Jane Doe', date: '2026-08-10', status: 'Completed', minutes: 45,
  trainer: 'Katie Castlio', ...over,
})

test('one row per member, with sessions and minutes summed', () => {
  const out = groupSessionsIntoClients([
    session(),
    session({ date: '2026-08-12', minutes: 30 }),
    session({ member: 'John Roe', minutes: 60 }),
  ])
  assert.equal(out.length, 2)
  const jane = out.find(c => c.member === 'Jane Doe')
  assert.equal(jane.sessions, 2)
  assert.equal(jane.minutes, 75)
})

test('last session is the latest date, not the last row', () => {
  const out = groupSessionsIntoClients([
    session({ date: '2026-08-20' }),
    session({ date: '2026-08-02' }),
  ])
  assert.equal(out[0].lastSeen, '2026-08-20')
})

test('busiest client leads, ties broken by name so the order is stable', () => {
  const out = groupSessionsIntoClients([
    session({ member: 'Zoe Last' }),
    session({ member: 'Amy First' }),
    session({ member: 'Busy Person' }),
    session({ member: 'Busy Person', date: '2026-08-11' }),
  ])
  assert.deepEqual(out.map(c => c.member), ['Busy Person', 'Amy First', 'Zoe Last'])
})

test('no sessions folds to no clients rather than throwing', () => {
  assert.deepEqual(groupSessionsIntoClients([]), [])
  assert.deepEqual(groupSessionsIntoClients(null), [])
})

// ---------------------------------------------------------------------------
// The definition the drill-down must not restate.
// ---------------------------------------------------------------------------

// The ACH filter reads this constant rather than its own regex. ABC writes
// 'EFT' for a bank draft, and a looser test would open a longer list than the
// number it was clicked from.
test('ACH is the report own constant, not a pattern', () => {
  assert.equal(ACH_PAYMENT_METHOD, 'EFT')
})
