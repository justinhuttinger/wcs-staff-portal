// Personal Day One links (/dayone/<slug>?c=<ghl contact id>): prefill shows a
// first name + last initial, and /api/book books that contact with no upsert.
const { test, beforeEach } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const http = require('http')
const express = require('express')

const LOC = { slug: 'salem', name: 'Salem', id: 'LOC_SALEM', apiKey: 'key' }
const CAL = { id: 'CAL1', slotDuration: 60, slotDurationUnit: 'mins', teamMembers: ['U1'] }

function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}

const CONTACTS = {
  abc123def456: { id: 'abc123def456', locationId: 'LOC_SALEM', firstName: 'Jane', lastName: 'doe' },
  other999other9: { id: 'other999other9', locationId: 'LOC_KEIZER', firstName: 'Kim' },
}
let calls = []
stub('../config/ghlLocations', { LOCATIONS: [LOC], getLocationBySlug: s => (s === 'salem' ? LOC : null) })
stub('../services/ghlClient', {
  sleep: async () => {},
  ghlFetch: async (p, key, opts = {}) => {
    calls.push({ path: p, method: opts.method || 'GET', body: opts.body })
    const m = /^\/contacts\/([^/]+)$/.exec(p)
    if (m && (opts.method || 'GET') === 'GET') {
      // The real key can't see another club's contact: GHL answers 403.
      const c = CONTACTS[m[1]]
      if (!c) throw new Error('GHL API error 404: not found')
      if (c.locationId !== LOC.id) throw new Error('GHL API error 403: no access')
      return { contact: c }
    }
    if (p === '/calendars/events/appointments') return { id: 'APPT1', assignedUserId: 'U1', startTime: opts.body.startTime }
    if (/customFields$/.test(p)) return { customFields: [] }
    if (m) return {}
    throw new Error(`unexpected ${p}`)
  },
})
const booking = require('../lib/ghlBooking')
booking.resolveBookingCalendar = async () => CAL
booking.getDayOneCalendar = async () => CAL

const router = require('./dayOneBooking')
const app = express()
app.use(express.json())
app.use('/dayone', router)

async function call(method, urlPath, body) {
  const server = app.listen(0)
  const { port } = server.address()
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ port, path: urlPath, method, headers: { 'Content-Type': 'application/json' } }, r => {
        let b = ''; r.on('data', c => (b += c)); r.on('end', () => resolve({ status: r.statusCode, json: b ? JSON.parse(b) : null }))
      })
      req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end()
    })
  } finally { server.close() }
}

beforeEach(() => { calls = [] })

test('prefill returns only first name + last initial', async () => {
  const r = await call('GET', '/dayone/api/prefill?location=salem&c=abc123def456')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { firstName: 'Jane', lastInitial: 'D' })
})

test('prefill 404s for another club, unknown ids and junk', async () => {
  for (const c of ['other999other9', 'nope00000000', '../x', '']) {
    const r = await call('GET', `/dayone/api/prefill?location=salem&c=${encodeURIComponent(c)}`)
    assert.equal(r.status, 404, c)
  }
})

test('booking with contactId books that contact, no upsert, name from GHL', async () => {
  const r = await call('POST', '/dayone/api/book', {
    location: 'salem', contactId: 'abc123def456', firstName: 'Spoof',
    userId: 'U1', startTime: '2026-10-10T16:00:00.000Z',
  })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.contactId, 'abc123def456')
  assert.ok(!calls.some(c => c.path === '/contacts/upsert'), 'no upsert')
  const appt = calls.find(c => c.path === '/calendars/events/appointments')
  assert.equal(appt.body.contactId, 'abc123def456')
  assert.equal(appt.body.title, 'Day One - Jane doe')
})

test('booking with another club\'s contactId is refused before anything is written', async () => {
  const r = await call('POST', '/dayone/api/book', {
    location: 'salem', contactId: 'other999other9', userId: 'U1', startTime: '2026-10-10T16:00:00.000Z',
  })
  assert.equal(r.status, 400)
  assert.equal(r.json.error, 'contact_not_found')
  assert.ok(!calls.some(c => c.method !== 'GET'))
})

test('typed booking without contactId still needs a name', async () => {
  const r = await call('POST', '/dayone/api/book', { location: 'salem', userId: 'U1', startTime: '2026-10-10T16:00:00.000Z', email: 'a@b.co' })
  assert.equal(r.status, 400)
  assert.equal(r.json.error, 'First name is required')
})
