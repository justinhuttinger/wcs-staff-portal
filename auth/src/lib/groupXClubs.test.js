const test = require('node:test')
const assert = require('node:assert')
const { CLUBS, clubBySlug, isKnownClubNumber } = require('./groupXClubs')

test('CLUBS has all seven gyms', () => {
  assert.strictEqual(CLUBS.length, 7)
})

test('clubBySlug resolves a known slug case-insensitively', () => {
  assert.strictEqual(clubBySlug('salem').clubNumber, '30935')
  assert.strictEqual(clubBySlug('SALEM').clubNumber, '30935')
})

test('clubBySlug returns null for an unknown slug', () => {
  assert.strictEqual(clubBySlug('portland'), null)
  assert.strictEqual(clubBySlug(''), null)
  assert.strictEqual(clubBySlug(undefined), null)
})

test('isKnownClubNumber rejects a club we do not own', () => {
  assert.strictEqual(isKnownClubNumber('30935'), true)
  assert.strictEqual(isKnownClubNumber('99999'), false)
})
