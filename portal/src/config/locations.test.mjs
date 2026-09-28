import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as loc from './locations.js'
import registry from './clubs.json' with { type: 'json' }

test('starts from the bundled list', () => {
  assert.deepEqual(loc.LOCATION_NAMES, ['Salem', 'Keizer', 'Eugene', 'Springfield', 'Clackamas', 'Milwaukie', 'Medford'])
  assert.equal(loc.LOCATIONS_WITH_ALL[0], 'All')
  assert.equal(loc.CLUB_NAME_BY_NUMBER['7655'], 'Eugene')
  assert.equal(loc.LOCATION_BACKGROUNDS.medford, '/bg-medford.jpg')
})

test('applyClubs refreshes every export in place and skips inactive clubs', () => {
  const refs = [loc.CLUBS, loc.LOCATION_NAMES, loc.LOCATION_OPTIONS, loc.CLUB_NAME_BY_NUMBER, loc.LOCATION_BACKGROUNDS]
  try {
    loc.applyClubs([
      ...registry.clubs,
      { slug: 'bend', name: 'Bend', clubNumber: '40123', active: true, background: 'https://x/bend.jpg' },
      { slug: 'closed', name: 'Closed', clubNumber: '40999', active: false },
    ])
    assert.equal(loc.CLUBS, refs[0])
    assert.equal(loc.LOCATION_NAMES.at(-1), 'Bend')
    assert.ok(!loc.LOCATION_NAMES.includes('Closed'))
    assert.deepEqual(loc.LOCATION_OPTIONS.at(-1), { slug: 'bend', label: 'Bend' })
    assert.equal(loc.CLUB_NAME_BY_NUMBER['40123'], 'Bend')
    assert.equal(loc.LOCATION_BACKGROUNDS.bend, 'https://x/bend.jpg')
    assert.equal(loc.LOCATIONS_WITH_ALL.length, 9)
  } finally {
    loc.applyClubs(registry.clubs)
  }
})
