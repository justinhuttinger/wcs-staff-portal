const test = require('node:test')
const assert = require('node:assert')
const { enabledIn, facilitiesFor, clubsWith } = require('./clubFeatures')

const FACILITIES = [{ slug: 'courts' }, { slug: 'pool' }]

test('an explicit false switches a facility off', () => {
  assert.strictEqual(enabledIn({ '30935:pool': false }, '30935', 'pool'), false)
  assert.strictEqual(enabledIn({ '30935:pool': true }, '30935', 'pool'), true)
})

test('a missing row means enabled', () => {
  // The table is seeded full, so this only happens for a club or facility added
  // in code before anyone configured it. Appearing switched on is a smaller
  // surprise than a board that silently renders nothing.
  assert.strictEqual(enabledIn({}, '30935', 'pool'), true)
  assert.strictEqual(enabledIn(undefined, '30935', 'pool'), true)
})

test('one club being off does not affect another', () => {
  const map = { '30935:pool': false }
  assert.strictEqual(enabledIn(map, '31599', 'pool'), true)
  assert.strictEqual(enabledIn(map, '30935', 'courts'), true)
})

test('facilitiesFor keeps allowlist order and drops what is off', () => {
  assert.deepStrictEqual(
    facilitiesFor({ '30935:courts': false }, '30935', FACILITIES).map(f => f.slug),
    ['pool'],
  )
  assert.deepStrictEqual(facilitiesFor({}, '30935', FACILITIES).map(f => f.slug), ['courts', 'pool'])
  assert.deepStrictEqual(
    facilitiesFor({ '30935:courts': false, '30935:pool': false }, '30935', FACILITIES),
    [],
  )
})

const CLUBS = [
  { slug: 'salem', clubNumber: '30935' },
  { slug: 'keizer', clubNumber: '31599' },
]

test('clubsWith narrows a club list to the ones that have a feature', () => {
  assert.deepStrictEqual(
    clubsWith({ '31599:groupx': false }, CLUBS, 'groupx').map(c => c.slug),
    ['salem'],
  )
  assert.deepStrictEqual(clubsWith({}, CLUBS, 'groupx').map(c => c.slug), ['salem', 'keizer'])
  assert.deepStrictEqual(
    clubsWith({ '30935:groupx': false, '31599:groupx': false }, CLUBS, 'groupx'),
    [],
  )
})

test('features are independent of each other', () => {
  // Turning Group X off at a club must not touch its pool, and vice versa.
  const map = { '30935:groupx': false }
  assert.strictEqual(enabledIn(map, '30935', 'pool'), true)
  assert.strictEqual(enabledIn(map, '30935', 'courts'), true)
  assert.strictEqual(enabledIn(map, '30935', 'groupx'), false)
})
