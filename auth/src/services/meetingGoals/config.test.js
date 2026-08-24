// node --test auth/src/services/meetingGoals/config.test.js
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { titleFor, KINDS } = require('./config')
const { ALL_SLUGS } = require('../../utils/locationSlug')

// The 14 articles that exist in Operandio, created by hand on 2026-08-24. If a
// title ever stops matching, publish skips that club rather than writing to the
// wrong place — so this test is the guard on the naming convention.
const LIVE_TITLES = [
  'MC Goals - Salem', 'MC Goals - Keizer', 'MC Goals - Eugene',
  'MC Goals - Springfield', 'MC Goals - Clackamas', 'MC Goals - Milwaukie',
  'MC Goals - Medford',
  'PT Goals - Salem', 'PT Goals - Keizer', 'PT Goals - Eugene',
  'PT Goals - Springfield', 'PT Goals - Clackamas', 'PT Goals - Milwaukie',
  'PT Goals - Medford',
]

test('titleFor reproduces every live article title exactly', () => {
  const generated = []
  for (const kind of Object.values(KINDS)) {
    for (const slug of ALL_SLUGS) generated.push(titleFor(kind, slug))
  }
  assert.deepEqual(generated.slice().sort(), LIVE_TITLES.slice().sort())
})

test('titleFor title-cases the slug', () => {
  assert.equal(titleFor('MC', 'salem'), 'MC Goals - Salem')
  assert.equal(titleFor('PT', 'springfield'), 'PT Goals - Springfield')
})

test('both meeting processes map to a kind', () => {
  assert.deepEqual(Object.values(KINDS).sort(), ['MC', 'PT'])
})
