const test = require('node:test')
const assert = require('node:assert/strict')

const clubs = require('./clubs')
const { rowToClub, decryptSecrets } = require('./loadClubs')
const bundled = require('./clubs.json').clubs

// The public.clubs row migration 215 writes for a registry entry.
function toRow(c, i) {
  return {
    club_number: c.clubNumber, slug: c.slug, name: c.name, sort_order: i + 1, active: c.active,
    env_key: c.envKey, ghl_location_id: c.ghlLocationId, state: c.state, timezone: c.timezone,
    abc_url: c.abcUrl, background: c.background, trading_name: c.tradingName || null,
  }
}

test('a database row round-trips to exactly the bundled club object', () => {
  bundled.forEach((c, i) => assert.deepEqual(rowToClub(toRow(c, i)), c, c.slug))
})

test('rowToClub fills defaults for a minimal new row', () => {
  const c = rowToClub({ club_number: '40000', slug: 'bend', name: 'Bend', sort_order: 8, active: true })
  assert.deepEqual(c, { slug: 'bend', name: 'Bend', clubNumber: '40000', envKey: 'BEND', timezone: 'America/Los_Angeles', active: true })
})

test('applyClubs replaces the list in place and filters inactive', () => {
  const before = { all: clubs.ALL_CLUBS, active: clubs.CLUBS, bySlug: clubs.CLUB_BY_SLUG }
  try {
    const extra = [...bundled, { slug: 'bend', name: 'Bend', clubNumber: '40000', envKey: 'BEND', timezone: 'America/Los_Angeles', active: false }]
    clubs.applyClubs(extra, new Map(), 'database')
    assert.equal(clubs.ALL_CLUBS, before.all, 'same array identity')
    assert.equal(clubs.CLUBS, before.active)
    assert.equal(clubs.CLUB_BY_SLUG, before.bySlug)
    assert.equal(clubs.ALL_CLUBS.length, 8)
    assert.equal(clubs.CLUBS.length, 7, 'inactive club not in CLUBS')
    assert.equal(clubs.clubBySlug('bend'), null)
    assert.equal(clubs.clubSource(), 'database')
  } finally {
    clubs.applyClubs(bundled)
  }
})

test('envFor: env var wins, then the club row / secrets, else undefined', () => {
  const salem = clubs.clubBySlug('salem')
  const saved = { ...process.env }
  try {
    delete process.env.GHL_API_KEY_SALEM
    delete process.env.GHL_LOCATION_SALEM
    delete process.env.PAYCHEX_COMPANY_SALEM
    assert.equal(clubs.envFor(salem, 'GHL_API_KEY_'), undefined)
    assert.equal(clubs.envFor(salem, 'GHL_LOCATION_'), salem.ghlLocationId, 'location id from the row')

    clubs.applyClubs(bundled, new Map([['30935', { ghlApiKey: 'pit-db', paychexCompanyId: 'PC1' }]]))
    const s = clubs.clubBySlug('salem')
    assert.equal(clubs.envFor(s, 'GHL_API_KEY_'), 'pit-db')
    assert.equal(clubs.envFor(s, 'PAYCHEX_COMPANY_'), 'PC1')

    process.env.GHL_API_KEY_SALEM = 'pit-env'
    assert.equal(clubs.envFor(s, 'GHL_API_KEY_'), 'pit-env', 'env var takes precedence')
    assert.equal(clubs.envFor(s, 'SOMETHING_ELSE_'), undefined)
  } finally {
    process.env = saved
    clubs.applyClubs(bundled)
  }
})

test('secrets never appear on club objects', () => {
  try {
    clubs.applyClubs(bundled, new Map([['30935', { ghlApiKey: 'pit-secret' }]]))
    assert.ok(!JSON.stringify(clubs.ALL_CLUBS).includes('pit-secret'))
    const { publicClub } = require('../routes/publicClubs')
    assert.ok(!JSON.stringify(clubs.ALL_CLUBS.map(publicClub)).includes('pit-secret'))
    assert.deepEqual(Object.keys(publicClub(clubs.clubBySlug('salem'))).sort(),
      ['abcUrl', 'active', 'background', 'clubNumber', 'name', 'slug', 'state', 'timezone'])
  } finally {
    clubs.applyClubs(bundled)
  }
})

test('decryptSecrets skips values that fail to decrypt', () => {
  const orig = console.error
  console.error = () => {}
  try {
    const out = decryptSecrets([
      { club_number: '1', ghl_api_key_enc: 'good', paychex_company_id_enc: 'bad' },
    ], v => { if (v === 'bad') throw new Error('nope'); return 'plain-' + v })
    assert.deepEqual(out.get('1'), { ghlApiKey: 'plain-good' })
  } finally {
    console.error = orig
  }
})
