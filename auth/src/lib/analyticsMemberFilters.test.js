const test = require('node:test')
const assert = require('node:assert')
const {
  parseCategory, parseBasis, filterNote, matchesFilters, MEMBER_CATEGORIES,
} = require('./analyticsMemberFilters')

test('category defaults to all and rejects anything unknown', () => {
  assert.strictEqual(parseCategory(undefined), 'all')
  assert.strictEqual(parseCategory(''), 'all')
  assert.strictEqual(parseCategory('Dues'), 'Dues')
  // An unrecognised value must fall back to the widest answer, never be passed
  // through to SQL where it would match no rows and read as "no members".
  assert.strictEqual(parseCategory('; drop table'), 'all')
  assert.strictEqual(parseCategory('insurance'), 'Insurance')
})

test('basis defaults to members and only agreements can change it', () => {
  assert.strictEqual(parseBasis(undefined), 'members')
  assert.strictEqual(parseBasis('agreements'), 'agreements')
  assert.strictEqual(parseBasis('Agreements'), 'agreements')
  assert.strictEqual(parseBasis('nonsense'), 'members')
})

// Unmapped is a state of our configuration, not a kind of membership. Asking
// for it widens to All rather than returning the unmapped rows, so nobody can
// build a report on "Other" and treat it as a segment.
test('Other is not a selectable category', () => {
  assert.strictEqual(parseCategory('Other'), 'all')
  assert.ok(!MEMBER_CATEGORIES.includes('Other'))
})

test('the note names the filter only when one is set', () => {
  assert.strictEqual(filterNote({ category: 'all', basis: 'members' }), undefined)
  assert.match(filterNote({ category: 'Insurance', basis: 'members' }), /Insurance/)
  assert.match(filterNote({ category: 'all', basis: 'agreements' }), /agreement/i)
  const both = filterNote({ category: 'Temp', basis: 'agreements' })
  assert.match(both, /Temp/)
  assert.match(both, /agreement/i)
})

test('matchesFilters keeps everything when nothing is filtered', () => {
  const row = { membership_category: 'Dues', is_primary_member: false }
  assert.strictEqual(matchesFilters(row, { category: 'all', basis: 'members' }), true)
})

test('matchesFilters drops the wrong category', () => {
  const row = { membership_category: 'Dues', is_primary_member: true }
  assert.strictEqual(matchesFilters(row, { category: 'Insurance', basis: 'members' }), false)
  assert.strictEqual(matchesFilters(row, { category: 'Dues', basis: 'members' }), true)
})

test('agreements keeps primaries only', () => {
  const primary = { membership_category: 'Dues', is_primary_member: true }
  const secondary = { membership_category: 'Dues', is_primary_member: false }
  assert.strictEqual(matchesFilters(primary, { category: 'all', basis: 'agreements' }), true)
  assert.strictEqual(matchesFilters(secondary, { category: 'all', basis: 'agreements' }), false)
})

// A row whose flag is null is a member ABC no longer returns (see migration
// 193). Counting it as an agreement would put a ghost back into the number the
// basis filter exists to make precise.
test('a null primary flag is not an agreement', () => {
  const ghost = { membership_category: 'Dues', is_primary_member: null }
  assert.strictEqual(matchesFilters(ghost, { category: 'all', basis: 'agreements' }), false)
  assert.strictEqual(matchesFilters(ghost, { category: 'all', basis: 'members' }), true)
})

// An unmapped member still exists: they count under All, and under none of the
// three named buckets. That is the whole contract of the category filter.
test('an unmapped row counts under All and under no named bucket', () => {
  const row = { membership_category: null, is_primary_member: true }
  assert.strictEqual(matchesFilters(row, { category: 'all', basis: 'members' }), true)
  assert.strictEqual(matchesFilters(row, { category: 'Dues', basis: 'members' }), false)
  assert.strictEqual(matchesFilters(row, { category: 'Insurance', basis: 'members' }), false)
  assert.strictEqual(matchesFilters(row, { category: 'Temp', basis: 'members' }), false)
})

// ---------------------------------------------------------------------------
// Resolving the category from a lookup, for reports that read abc_members
// directly rather than through abc_members_counted.
//
// Salesperson Performance, Salesperson Snapshot and Attrition Analysis all
// select named columns from abc_members in JS. Pointing them at the view to
// pick up membership_category would add two joins to three hot queries for one
// string, so they pass the mapping instead — 33 rows, read once.
// ---------------------------------------------------------------------------

const CATEGORY_MAP = new Map([
  ['single', 'Dues'],
  ['a2 core - active adult core', 'Insurance'],
  ['temporary single', 'Temp'],
])

test('the category is resolved from membership_type when a map is given', () => {
  const dues = { membership_type: 'SINGLE', is_primary_member: true }
  const ins = { membership_type: 'A2 CORE - Active Adult Core', is_primary_member: true }
  assert.strictEqual(matchesFilters(dues, { category: 'Dues', basis: 'members', categoryMap: CATEGORY_MAP }), true)
  assert.strictEqual(matchesFilters(dues, { category: 'Insurance', basis: 'members', categoryMap: CATEGORY_MAP }), false)
  assert.strictEqual(matchesFilters(ins, { category: 'Insurance', basis: 'members', categoryMap: CATEGORY_MAP }), true)
})

// ABC spells the same plan more than one way; the mapping is keyed on the
// lowercased type for exactly that reason, and the row's own casing must not
// decide whether it matches.
test('matching the map is case-insensitive', () => {
  const row = { membership_type: 'single', is_primary_member: true }
  assert.strictEqual(matchesFilters(row, { category: 'Dues', basis: 'members', categoryMap: CATEGORY_MAP }), true)
})

test('an unmapped type matches none of the named categories', () => {
  const row = { membership_type: 'CORP PREMIUM', is_primary_member: true }
  for (const c of ['Dues', 'Insurance', 'Temp']) {
    assert.strictEqual(matchesFilters(row, { category: c, basis: 'members', categoryMap: CATEGORY_MAP }), false)
  }
  assert.strictEqual(matchesFilters(row, { category: 'all', basis: 'members', categoryMap: CATEGORY_MAP }), true)
})

// The map is an override, not a requirement: rows that already carry
// membership_category keep working, so one function serves both shapes.
test('a row carrying membership_category still works without a map', () => {
  const row = { membership_category: 'Insurance', is_primary_member: true }
  assert.strictEqual(matchesFilters(row, { category: 'Insurance', basis: 'members' }), true)
})

test('the basis rule is unaffected by the map', () => {
  const secondary = { membership_type: 'SINGLE', is_primary_member: false }
  assert.strictEqual(matchesFilters(secondary, { category: 'all', basis: 'agreements', categoryMap: CATEGORY_MAP }), false)
  assert.strictEqual(matchesFilters(secondary, { category: 'all', basis: 'members', categoryMap: CATEGORY_MAP }), true)
})
