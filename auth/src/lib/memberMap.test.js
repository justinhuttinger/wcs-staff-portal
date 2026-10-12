const test = require('node:test')
const assert = require('node:assert')
const { buildMemberMap, milesBetween } = require('./memberMap')

const CLUBS = [
  { club_number: '30935', slug: 'salem', name: 'Salem', address: 'a', lat: 44.9483, lng: -123.0485 },
  { club_number: '31599', slug: 'keizer', name: 'Keizer', address: 'b', lat: 44.9982, lng: -123.0283 },
  { club_number: '7655', slug: 'eugene', name: 'Eugene', address: 'c', lat: 44.0934, lng: -123.0954 },
]

test('milesBetween: Salem club to Keizer club is about 3.6 miles', () => {
  const d = milesBetween(44.9483, -123.0485, 44.9982, -123.0283)
  assert.ok(d > 3.4 && d < 3.8, String(d))
})

test('buildMemberMap scores distance, nearest club and unmapped members', () => {
  const members = [
    // Lives at Keizer's door but belongs to Salem.
    { member_id: 1, club_number: '30935', first_name: 'ANN', last_name: 'LEE', address_line1: '1 A St', city: 'Keizer', state: 'OR', postal_code: '97303-1234', address_key: 'K1' },
    // Lives at the Salem club.
    { member_id: 2, club_number: '30935', first_name: 'bo', last_name: 'k', address_line1: '2 B St', city: 'Salem', state: 'OR', postal_code: '97304', address_key: 'S1' },
    // Address did not geocode.
    { member_id: 3, club_number: '30935', first_name: 'c', last_name: 'd', address_line1: 'x', city: 'y', state: 'OR', postal_code: '1', address_key: 'NOPE' },
    // Eugene member, but Eugene is not selected.
    { member_id: 4, club_number: '7655', first_name: 'e', last_name: 'f', address_line1: 'z', city: 'Eugene', state: 'OR', postal_code: '97408', address_key: 'E1' },
  ]
  const geocodes = new Map([
    ['K1', { lat: 44.9982, lng: -123.0283 }],
    ['S1', { lat: 44.9483, lng: -123.0485 }],
    ['E1', { lat: 44.0934, lng: -123.0954 }],
  ])
  const out = buildMemberMap({ members, geocodes, clubs: CLUBS, selected: new Set(['30935', '31599']) })

  assert.strictEqual(out.points.length, 2)
  const ann = out.points.find(p => p[5] === '1')
  assert.strictEqual(ann[2], 0) // home = Salem
  assert.strictEqual(ann[7], 1) // nearest = Keizer
  assert.strictEqual(ann[3], 'Ann Lee')
  assert.strictEqual(ann[4], '1 A St, Keizer, OR 97303')

  // Keizer has no members in view, Eugene is not selected: both omitted.
  assert.deepStrictEqual(out.stats.map(s => s.name), ['Salem'])
  const salem = out.stats[0]
  assert.strictEqual(salem.members, 3)
  assert.strictEqual(salem.mapped, 2)
  assert.strictEqual(salem.unmapped, 1)
  assert.strictEqual(salem.nearer_other, 1)
  assert.strictEqual(salem.within_pct[3], 50)
  assert.strictEqual(salem.within_pct[5], 100)
  assert.strictEqual(out.clubs.length, 3)
})
