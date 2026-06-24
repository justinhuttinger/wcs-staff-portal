const test = require('node:test')
const assert = require('node:assert')
const { LOCATIONS, CATEGORIES, getLocation, enabledLocations } = require('./config')

test('exactly the 6 target locations, Milwaukie excluded', () => {
  const keys = LOCATIONS.map(l => l.key).sort()
  assert.deepEqual(keys, ['Clackamas', 'Eugene', 'Keizer', 'Medford', 'Salem', 'Springfield'])
  assert.ok(!keys.includes('Milwaukie'))
})

test('every location has non-empty SEO context', () => {
  for (const l of LOCATIONS) {
    assert.ok(l.keywords.length >= 3, `${l.key} keywords`)
    assert.ok(l.localContext && l.localContext.length > 20, `${l.key} context`)
    assert.ok(l.wpCategory, `${l.key} wpCategory`)
  }
})

test('getLocation + enabledLocations', () => {
  assert.equal(getLocation('Salem').city, 'Salem')
  assert.equal(getLocation('nope'), undefined)
  assert.ok(enabledLocations().every(l => l.enabled))
})

test('categories have topics', () => {
  assert.ok(CATEGORIES.length >= 4)
  for (const c of CATEGORIES) assert.ok(c.topics.length >= 4, `${c.key} topics`)
})
