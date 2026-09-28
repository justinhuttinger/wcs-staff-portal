const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..', '..')
const clubs = require('./clubs')

test('every service copy matches config/clubs.json (run scripts/sync-clubs.js)', () => {
  const source = fs.readFileSync(path.join(ROOT, 'config', 'clubs.json'), 'utf8')
  for (const rel of ['auth/src/config/clubs.json', 'ghl-sync/src/config/clubs.json', 'portal/src/config/clubs.json', 'launcher/src/clubs.json']) {
    assert.equal(fs.readFileSync(path.join(ROOT, rel), 'utf8'), source, `${rel} is stale`)
  }
})

test('each club has the fields the rest of the code relies on', () => {
  for (const c of clubs.ALL_CLUBS) {
    assert.match(c.slug, /^[a-z]+$/, `slug ${c.slug}`)
    assert.ok(c.name, `${c.slug} name`)
    assert.match(c.clubNumber, /^[1-9]\d*$/, `${c.slug} clubNumber (no leading zero)`)
    assert.match(c.envKey, /^[A-Z_]+$/, `${c.slug} envKey`)
    assert.match(c.ghlLocationId, /^[A-Za-z0-9]{20}$/, `${c.slug} ghlLocationId`)
    assert.ok(c.state, `${c.slug} state`)
    assert.ok(c.timezone, `${c.slug} timezone`)
    assert.equal(typeof c.active, 'boolean', `${c.slug} active`)
  }
})

test('slugs, names, club numbers and env keys are unique', () => {
  for (const key of ['slug', 'name', 'clubNumber', 'envKey', 'ghlLocationId']) {
    const values = clubs.ALL_CLUBS.map(c => c[key].toLowerCase())
    assert.equal(new Set(values).size, values.length, `duplicate ${key}`)
  }
})

// Pins today's clubs and order. Adding a club should change this test on purpose.
test('the current clubs, in house order', () => {
  assert.deepEqual(
    clubs.CLUBS.map(c => [c.slug, c.name, c.clubNumber]),
    [
      ['salem', 'Salem', '30935'],
      ['keizer', 'Keizer', '31599'],
      ['eugene', 'Eugene', '7655'],
      ['springfield', 'Springfield', '31598'],
      ['clackamas', 'Clackamas', '31600'],
      ['milwaukie', 'Milwaukie', '31601'],
      ['medford', 'Medford', '32073'],
    ],
  )
})

test('lookups', () => {
  assert.equal(clubs.clubBySlug(' Salem ').clubNumber, '30935')
  assert.equal(clubs.clubByNumber('07655').slug, 'eugene')
  assert.equal(clubs.clubByNumber(31601).slug, 'milwaukie')
  assert.equal(clubs.clubByName('MEDFORD').slug, 'medford')
  assert.equal(clubs.clubBySlug('nope'), null)
  assert.equal(clubs.clubByNumber(''), null)
})

test('existing modules derive the same values they used to hardcode', () => {
  const { ALL_SLUGS, SLUG_CLUB_MAP } = require('../utils/locationSlug')
  assert.deepEqual(ALL_SLUGS, ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford'])
  assert.deepEqual(SLUG_CLUB_MAP, {
    salem: '30935', keizer: '31599', eugene: '7655', springfield: '31598',
    clackamas: '31600', milwaukie: '31601', medford: '32073',
  })
  assert.deepEqual(require('./clubMap').NAME_TO_CLUB, SLUG_CLUB_MAP)
  const sp = require('../lib/salespersonPerformance')
  assert.equal(sp.CLUB_BY_SLUG.milwaukie.name, 'East Side Athletic Club')
  assert.equal(sp.clubName('07655'), 'Eugene')
  const gx = require('../lib/groupXClubs')
  assert.deepEqual(gx.CLUBS[0], { slug: 'salem', name: 'Salem', clubNumber: '30935' })
  assert.equal(gx.isKnownClubNumber('32073'), true)
})
