const test = require('node:test')
const assert = require('node:assert')
const {
  SETS, setKeys, clubNumbersFor, matchesPerson, groupSessionsIntoClients,
  tenureMonths, LOST_STATUSES,
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

// ---------------------------------------------------------------------------
// The sets added for the club-wide snapshots.
// ---------------------------------------------------------------------------

test('the club-wide sets exist and are renderable', () => {
  for (const key of ['lost-members', 'past-due', 'revenue']) {
    assert.ok(SETS[key], `missing set: ${key}`)
  }
})

// ---------------------------------------------------------------------------
// The sets Club Health needed of its own.
//
// Club Health counts its membership on sign_date where Analytics counts on
// since_date, and its Cancels card does not apply the conditional-membership
// rule where Analytics' does. These sets exist so each of its cards opens the
// rows IT counted; the guard here is that they stay distinct from the
// Analytics ones rather than quietly being aliased back onto them.
// ---------------------------------------------------------------------------

test('Club Health has its own sets, and they are renderable', () => {
  for (const key of ['club-health-sales', 'club-health-active', 'club-health-cancels', 'club-health-vips']) {
    const set = SETS[key]
    assert.ok(set, `missing set: ${key}`)
    assert.ok(set.label, `${key} has no label`)
    assert.ok(Array.isArray(set.columns) && set.columns.length > 0, `${key} declares no columns`)
    assert.equal(typeof set.load, 'function', `${key} has no loader`)
    for (const col of set.columns) {
      assert.ok(col.key && col.label && col.format, `${key} has an incomplete column`)
    }
  }
})

// The whole reason these exist. If either pair is ever pointed at the same
// loader, one of the two cards is opening a list that does not match it.
test('Club Health sets are not aliases of the Analytics ones', () => {
  assert.notEqual(SETS['club-health-sales'].load, SETS['new-members'].load)
  assert.notEqual(SETS['club-health-cancels'].load, SETS['lost-members'].load)
  assert.notEqual(SETS['club-health-vips'].load, SETS['vips'].load)
})

// Active Members is the roster as it stands, whatever range is on screen, so
// its loader must not read the window. Destructuring is the signature: a start
// or end named there would mean the list had quietly become date-scoped while
// the card above it had not.
test('the Active Members set does not read the date window', () => {
  const params = String(SETS['club-health-active'].load).match(/\(([^)]*)\)/)[1]
  assert.ok(!/\bstart\b/.test(params), 'club-health-active reads start')
  assert.ok(!/\bend\b/.test(params), 'club-health-active reads end')
})

// analytics_topline_window counts exactly these three as gone. A looser list
// would open more rows than the card it was clicked from.
test('a lost member is one of the report three statuses', () => {
  assert.deepEqual(LOST_STATUSES, ['Cancelled', 'Expired', 'Return For Collection'])
})

test('tenure is whole months between joining and leaving', () => {
  assert.equal(tenureMonths('2026-01-01', '2026-08-01'), 7)
  assert.equal(tenureMonths('2026-08-01', '2026-08-15'), 0)
})

// A member with no join date on file has unknown tenure, not zero: zero would
// read as "joined and left the same day", which is a different claim.
test('an unknown date gives unknown tenure, not zero', () => {
  assert.equal(tenureMonths(null, '2026-08-01'), null)
  assert.equal(tenureMonths('2026-01-01', null), null)
  assert.equal(tenureMonths('not a date', '2026-08-01'), null)
})

// Leaving before joining is bad data, not negative tenure.
test('tenure never goes negative', () => {
  assert.equal(tenureMonths('2026-08-01', '2026-01-01'), 0)
})

// ---------------------------------------------------------------------------
// Reporting's category tick boxes reach the drill-downs, so a list never holds
// rows the card it was opened from left out.
// ---------------------------------------------------------------------------

test('applyCategoryExclusion drops unticked categories on membership-typed sets only', () => {
  const { applyCategoryExclusion, MEMBERSHIP_TYPED_SETS } = require('./analyticsRecords')
  const map = new Map([['a2 core', 'Insurance'], ['single', 'Dues']])
  const rows = [{ type: 'A2 CORE' }, { type: 'SINGLE' }, { type: 'MYSTERY PLAN' }, { type: '-' }]

  const kept = applyCategoryExclusion('club-health-active', rows, ['Insurance'], map)
  assert.deepStrictEqual(kept.map(r => r.type), ['SINGLE', 'MYSTERY PLAN', '-'])

  // Nothing unticked, or a set whose `type` is not a membership: untouched.
  assert.strictEqual(applyCategoryExclusion('club-health-active', rows, [], map), rows)
  assert.strictEqual(applyCategoryExclusion('pt-sales', rows, ['Insurance'], map), rows)

  // Every listed set actually exists and carries a Membership type column.
  for (const key of MEMBERSHIP_TYPED_SETS) {
    assert.ok(SETS[key], `${key} is not a record set`)
    assert.ok(SETS[key].columns.some(c => c.key === 'type' && c.label === 'Membership'),
      `${key} has no Membership type column`)
  }
})
