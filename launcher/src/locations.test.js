const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

process.env.WCS_CLUBS_CACHE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wcs-clubs-')), 'clubs-cache.json')
const loc = require('./locations')
const bundled = require('./clubs.json').clubs

const bend = { slug: 'bend', name: 'Bend', clubNumber: '40123', abcUrl: 'https://abc.example/bend', active: true }
const ok = (clubs) => async () => ({ ok: true, json: async () => ({ clubs }) })
const down = async () => { throw new Error('offline') }

test('starts from the bundled list with the scraper map longest-number first', () => {
  assert.equal(loc.LOCATIONS.length, 7)
  assert.deepEqual(Object.entries(loc.CLUB_NUMBERS).at(-1), ['Eugene', '7655'])
  assert.equal(loc.getAbcUrlFor('medford'), bundled.find(c => c.slug === 'medford').abcUrl)
})

test('refreshClubs takes the API list, caches it, and updates in place', async () => {
  const refs = [loc.LOCATIONS, loc.CLUB_NUMBERS]
  assert.equal(await loc.refreshClubs({ apiUrl: 'x', fetchImpl: ok([...bundled, bend]) }), 'api')
  assert.equal(loc.LOCATIONS, refs[0])
  assert.equal(loc.CLUB_NUMBERS, refs[1])
  assert.equal(loc.getAbcUrlFor('Bend'), 'https://abc.example/bend')
  assert.equal(loc.CLUB_NUMBERS.Bend, '40123')
  assert.ok(fs.existsSync(process.env.WCS_CLUBS_CACHE))
})

test('offline: falls back to the cache, then to the bundled list', async () => {
  loc.applyClubs(bundled)
  assert.equal(await loc.refreshClubs({ apiUrl: 'x', fetchImpl: down }), 'cache')
  assert.equal(loc.getAbcUrlFor('Bend'), 'https://abc.example/bend', 'from cache')
  fs.unlinkSync(process.env.WCS_CLUBS_CACHE)
  loc.applyClubs(bundled)
  assert.equal(await loc.refreshClubs({ apiUrl: 'x', fetchImpl: down }), 'bundled')
  assert.equal(loc.LOCATIONS.length, 7)
})

test('a bad API answer never replaces the list', async () => {
  loc.applyClubs(bundled)
  assert.equal(await loc.refreshClubs({ apiUrl: 'x', fetchImpl: ok([]) }), 'bundled')
  assert.equal(await loc.refreshClubs({ apiUrl: 'x', fetchImpl: async () => ({ ok: false }) }), 'bundled')
  assert.equal(loc.LOCATIONS.length, 7)
})

test('startup uses the cache immediately and refreshes in the background', async () => {
  fs.writeFileSync(process.env.WCS_CLUBS_CACHE, JSON.stringify([...bundled, bend]))
  loc.applyClubs(bundled)
  let resolveFetch
  const slow = () => new Promise(r => { resolveFetch = r })
  const src = await loc.loadClubsAtStartup({ apiUrl: 'x', fetchImpl: slow })
  assert.equal(src, 'cache', 'did not wait for the network')
  assert.equal(loc.CLUB_NUMBERS.Bend, '40123')
  resolveFetch({ ok: true, json: async () => ({ clubs: bundled }) })
  await new Promise(r => setTimeout(r, 20))
  assert.equal(loc.CLUB_NUMBERS.Bend, undefined, 'background refresh applied')
})
