const test = require('node:test')
const assert = require('node:assert')
const { chooseTrainer } = require('./dayOneBooking')

// The "Anyone" pick replaces GHL's hidden round-robin with our own, so it has
// to be deterministic (the name is shown before booking and must match what is
// assigned) and fair (highest priority alone would starve the rest of the team).

const seth = { userId: 'u-seth', name: 'Seth Tripp', priority: 1 }
const matt = { userId: 'u-matt', name: 'Matt Turnquist', priority: 0.5 }
const astley = { userId: 'u-astley', name: 'Matthew Astley', priority: 0.5 }
const cedric = { userId: 'u-cedric', name: 'Cedric Gatter', priority: 0.5 }
const cody = { userId: 'u-cody', name: 'Cody Warner', priority: 0 }

test('returns null when nobody is free', () => {
  assert.equal(chooseTrainer([], {}), null)
})

test('keeps only the highest priority tier present', () => {
  // Seth outranks the 0.5 tier, so he takes it even with more on his plate.
  const pick = chooseTrainer([matt, seth, cody], { 'u-seth': 9, 'u-matt': 0 })
  assert.equal(pick.userId, 'u-seth')
})

test('a priority-0 member is reached only when alone', () => {
  assert.equal(chooseTrainer([cody], {}).userId, 'u-cody')
  assert.equal(chooseTrainer([cody, matt], {}).userId, 'u-matt')
})

test('balances within a tier by fewest upcoming Day Ones', () => {
  const counts = { 'u-cedric': 5, 'u-matt': 1, 'u-astley': 3 }
  const pick = chooseTrainer([cedric, matt, astley], counts)
  assert.equal(pick.userId, 'u-matt', 'the least-loaded trainer in the tier wins')
})

test('load beats alphabetical order', () => {
  // Cedric sorts first by name; a heavier load must still push him behind.
  const pick = chooseTrainer([cedric, astley], { 'u-cedric': 4, 'u-astley': 0 })
  assert.equal(pick.userId, 'u-astley')
})

test('ties break on name so the result is deterministic', () => {
  const counts = { 'u-cedric': 2, 'u-astley': 2, 'u-matt': 2 }
  const first = chooseTrainer([matt, astley, cedric], counts)
  const again = chooseTrainer([cedric, matt, astley], counts)
  assert.equal(first.userId, 'u-cedric', 'Cedric Gatter sorts first')
  assert.equal(again.userId, first.userId, 'input order must not change the pick')
})

test('an absent count is treated as zero, not as missing', () => {
  // A trainer with no upcoming appointments should be preferred, not skipped.
  const pick = chooseTrainer([cedric, astley], { 'u-cedric': 3 })
  assert.equal(pick.userId, 'u-astley')
})

test('a null priority is treated as the bottom tier', () => {
  // trainerRoster leaves priority null when the calendar omits it; that must
  // not silently outrank a real 0.5 member.
  const unset = { userId: 'u-unset', name: 'Aaron Unset', priority: null }
  assert.equal(chooseTrainer([unset, matt], {}).userId, 'u-matt')
})

test('does not mutate the caller array', () => {
  const input = [matt, cedric, astley]
  const copy = input.slice()
  chooseTrainer(input, {})
  assert.deepEqual(input, copy)
})
