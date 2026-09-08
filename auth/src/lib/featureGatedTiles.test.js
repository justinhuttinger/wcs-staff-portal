const test = require('node:test')
const assert = require('node:assert')
const { hasGatedKeys, filterByFeatures } = require('./featureGatedTiles')

const EUGENE = { slug: 'eugene', clubNumber: '7655' }
const SPRINGFIELD = { slug: 'springfield', clubNumber: '31598' }

// Eugene has neither; Springfield has both.
const MAP = {
  '7655:courts': false,
  '7655:pool': false,
  '31598:courts': true,
  '31598:pool': true,
}

test('hasGatedKeys only fires for keys that need a feature', () => {
  assert.strictEqual(hasGatedKeys(['reporting', 'till']), false)
  assert.strictEqual(hasGatedKeys(['reporting', 'facility']), true)
  assert.strictEqual(hasGatedKeys([]), false)
  assert.strictEqual(hasGatedKeys(undefined), false)
})

test('a club with neither courts nor pool loses the Courts & Pool keys', () => {
  const kept = filterByFeatures(
    ['reporting', 'facility', 'facility:schedule-edit'], [EUGENE], MAP)
  assert.deepStrictEqual(kept, ['reporting'])
})

test('one club having the facility keeps the tile for a multi-club member', () => {
  const kept = filterByFeatures(['facility'], [EUGENE, SPRINGFIELD], MAP)
  assert.deepStrictEqual(kept, ['facility'])
})

test('either facility alone is enough', () => {
  const poolOnly = { '31600:courts': false, '31600:pool': true }
  const kept = filterByFeatures(['facility'], [{ clubNumber: '31600' }], poolOnly)
  assert.deepStrictEqual(kept, ['facility'])
})

test('ungated keys pass through untouched', () => {
  const keys = ['reporting', 'till', 'ticketing']
  assert.deepStrictEqual(filterByFeatures(keys, [EUGENE], MAP), keys)
})

test('no clubs means no gated tiles', () => {
  // Matches allowedClubsFor: a member with no assigned locations sees nothing
  // rather than everything.
  assert.deepStrictEqual(filterByFeatures(['facility', 'reporting'], [], MAP), ['reporting'])
})

test('Group X keys follow the groupx feature', () => {
  const off = { '7655:groupx': false }
  assert.deepStrictEqual(
    filterByFeatures(['groupX', 'groupX:attendance', 'reporting'], [EUGENE], off), ['reporting'])
  assert.deepStrictEqual(
    filterByFeatures(['groupX'], [EUGENE], {}), ['groupX'])
})
