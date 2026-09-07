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

test('Other is selectable, because an unmapped type has to be findable', () => {
  assert.strictEqual(parseCategory('Other'), 'Other')
  assert.ok(MEMBER_CATEGORIES.includes('Other'))
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

test('an unmapped row reads as Other rather than falling out of every bucket', () => {
  const row = { membership_category: null, is_primary_member: true }
  assert.strictEqual(matchesFilters(row, { category: 'Other', basis: 'members' }), true)
  assert.strictEqual(matchesFilters(row, { category: 'Dues', basis: 'members' }), false)
})
