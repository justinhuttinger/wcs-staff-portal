const test = require('node:test')
const assert = require('node:assert')
const { clubsForSlugs } = require('./groupXScope')

test('clubsForSlugs keeps only the assigned clubs', () => {
  const got = clubsForSlugs(['salem', 'medford'])
  assert.deepEqual(got.map(c => c.slug), ['salem', 'medford'])
})

test('clubsForSlugs is case insensitive', () => {
  assert.deepEqual(clubsForSlugs(['SALEM']).map(c => c.slug), ['salem'])
})

test('clubsForSlugs ignores slugs that are not clubs', () => {
  assert.deepEqual(clubsForSlugs(['portland', 'eugene']).map(c => c.slug), ['eugene'])
})

test('clubsForSlugs returns nothing for an empty or missing list', () => {
  assert.deepEqual(clubsForSlugs([]), [])
  assert.deepEqual(clubsForSlugs(undefined), [])
})

test('clubsForSlugs returns CLUBS order, not argument order', () => {
  assert.deepEqual(clubsForSlugs(['medford', 'salem']).map(c => c.slug), ['salem', 'medford'])
})
