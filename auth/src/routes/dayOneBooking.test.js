const test = require('node:test')
const assert = require('node:assert')
const { orderCandidates } = require('./dayOneBooking')

// The "Anyone" pick replaces GHL's hidden round-robin with our own, so it has
// to be deterministic (the name is shown before booking and must match what is
// assigned) and fair (highest priority alone would starve the rest of the team).
//
// orderCandidates returns the whole roster in the order we would hand out the
// slot; the caller walks it and takes the first trainer who is actually free.
// So position 0 is "who gets it if everyone is free", and the tail is the
// fallback order when the earlier ones are busy.

const seth = { userId: 'u-seth', name: 'Seth Tripp', priority: 1 }
const matt = { userId: 'u-matt', name: 'Matt Turnquist', priority: 0.5 }
const astley = { userId: 'u-astley', name: 'Matthew Astley', priority: 0.5 }
const cedric = { userId: 'u-cedric', name: 'Cedric Gatter', priority: 0.5 }
const cody = { userId: 'u-cody', name: 'Cody Warner', priority: 0 }

const ids = list => list.map(t => t.userId)

test('an empty roster yields no candidates', () => {
  assert.deepEqual(orderCandidates([], {}), [])
})

test('higher priority comes first even when more loaded', () => {
  const order = orderCandidates([matt, seth, cody], { 'u-seth': 9, 'u-matt': 0 })
  assert.equal(order[0].userId, 'u-seth')
})

test('a priority-0 member sorts last, so they are only reached as a fallback', () => {
  const order = orderCandidates([cody, matt, seth], {})
  assert.deepEqual(ids(order), ['u-seth', 'u-matt', 'u-cody'])
})

test('balances within a tier by fewest upcoming Day Ones', () => {
  const counts = { 'u-cedric': 5, 'u-matt': 1, 'u-astley': 3 }
  const order = orderCandidates([cedric, matt, astley], counts)
  assert.deepEqual(ids(order), ['u-matt', 'u-astley', 'u-cedric'])
})

test('load beats alphabetical order', () => {
  // Cedric sorts first by name; a heavier load must still push him behind.
  const order = orderCandidates([cedric, astley], { 'u-cedric': 4, 'u-astley': 0 })
  assert.equal(order[0].userId, 'u-astley')
})

test('ties break on name, and input order cannot change the result', () => {
  const counts = { 'u-cedric': 2, 'u-astley': 2, 'u-matt': 2 }
  const first = orderCandidates([matt, astley, cedric], counts)
  const again = orderCandidates([cedric, matt, astley], counts)
  assert.deepEqual(ids(first), ['u-cedric', 'u-matt', 'u-astley'])
  assert.deepEqual(ids(again), ids(first))
})

test('an absent count is treated as zero, not as missing', () => {
  // A trainer with no upcoming appointments should be preferred, not skipped.
  const order = orderCandidates([cedric, astley], { 'u-cedric': 3 })
  assert.equal(order[0].userId, 'u-astley')
})

test('a null priority is treated as the bottom tier', () => {
  // trainerRoster leaves priority null when the calendar omits it; that must
  // not silently outrank a real 0.5 member.
  const unset = { userId: 'u-unset', name: 'Aaron Unset', priority: null }
  const order = orderCandidates([unset, matt], {})
  assert.equal(order[0].userId, 'u-matt')
})

test('every trainer stays in the list, so a busy roster still has fallbacks', () => {
  const order = orderCandidates([matt, seth, cody, astley, cedric], {})
  assert.equal(order.length, 5, 'ordering must not drop anyone')
})

test('does not mutate the caller array', () => {
  const input = [matt, cedric, astley]
  const copy = input.slice()
  orderCandidates(input, {})
  assert.deepEqual(input, copy)
})
