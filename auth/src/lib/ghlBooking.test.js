const test = require('node:test')
const assert = require('node:assert')
const { toRoster } = require('./ghlBooking')

// The Day One calendar's round-robin membership decides who may run a Day One.
// toRoster turns that raw membership into the list staff actually see.

const users = {
  'u-seth': { name: 'Seth Tripp', email: 'seth@x.com' },
  'u-cody': { name: 'Cody Warner', email: 'cody@x.com' },
  'u-anna': { name: 'Anna Reed', email: 'anna@x.com' },
}

test('members are resolved to real names', () => {
  const roster = toRoster({ teamMembers: [{ userId: 'u-seth', priority: 1 }] }, users)
  assert.deepEqual(roster, [{ userId: 'u-seth', name: 'Seth Tripp', email: 'seth@x.com', priority: 1 }])
})

test('higher round-robin priority comes first', () => {
  const roster = toRoster({
    teamMembers: [{ userId: 'u-cody', priority: 0 }, { userId: 'u-seth', priority: 1 }],
  }, users)
  assert.deepEqual(roster.map(t => t.name), ['Seth Tripp', 'Cody Warner'])
})

test('a tie breaks on name so the order is stable between requests', () => {
  const roster = toRoster({
    teamMembers: [{ userId: 'u-seth', priority: 0.5 }, { userId: 'u-anna', priority: 0.5 }],
  }, users)
  assert.deepEqual(roster.map(t => t.name), ['Anna Reed', 'Seth Tripp'])
})

test('a bare user id is accepted, not just an object', () => {
  assert.deepEqual(toRoster({ teamMembers: ['u-anna'] }, users).map(t => t.name), ['Anna Reed'])
})

test('a member with no matching user is dropped, never shown blank', () => {
  const roster = toRoster({ teamMembers: [{ userId: 'ghost' }, { userId: 'u-anna' }] }, users)
  assert.deepEqual(roster.map(t => t.name), ['Anna Reed'])
})

test('a null priority sorts to the bottom tier', () => {
  const roster = toRoster({
    teamMembers: [{ userId: 'u-anna' }, { userId: 'u-seth', priority: 1 }],
  }, users)
  assert.deepEqual(roster.map(t => t.name), ['Seth Tripp', 'Anna Reed'])
})

test('a calendar with no team members yields an empty roster, not a throw', () => {
  assert.deepEqual(toRoster({}, users), [])
  assert.deepEqual(toRoster({ teamMembers: null }, users), [])
})
