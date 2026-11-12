// Gym Tour booking page (/tour/<slug>): calendar lookup, required fields,
// personal ?c= links and "Not you?" (typed details win once the link is dropped).
const { test, beforeEach } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const http = require('http')
const express = require('express')

const LOC = { slug: 'salem', name: 'Salem', id: 'LOC_SALEM', apiKey: 'key' }
const CAL = { id: 'TOURCAL1234', locationId: 'LOC_SALEM', name: 'Salem Gym Tour', slotDuration: 15, slotDurationUnit: 'mins' }

function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}

const CONTACTS = {
  abc123def456: { id: 'abc123def456', locationId: 'LOC_SALEM', firstName: 'Jane', lastName: 'doe' },
  other999other9: { id: 'other999other9', locationId: 'LOC_KEIZER', firstName: 'Kim' },
}
let calls = []
let config = {}
stub('../config/ghlLocations', { LOCATIONS: [LOC], getLocationBySlug: s => (s === 'salem' ? LOC : null) })
stub('../services/supabase', {
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        in: async (col, keys) => ({ data: keys.filter(k => config[k]).map(k => ({ key: k, value: config[k] })), error: null }),
      }),
    }),
  },
})
stub('../services/ghlClient', {
  sleep: async () => {},
  ghlFetch: async (p, key, opts = {}) => {
    const method = opts.method || 'GET'
    calls.push({ path: p, method, body: opts.body, params: opts.params })
    const m = /^\/contacts\/([^/]+)$/.exec(p)
    if (m && method === 'GET') {
      const c = CONTACTS[m[1]]
      if (!c) throw new Error('GHL API error 404: not found')
      if (c.locationId !== LOC.id) throw new Error('GHL API error 403: no access')
      return { contact: c }
    }
    if (p === `/calendars/${CAL.id}`) return { calendar: CAL }
    if (p === '/calendars/OTHERCAL99999') return { calendar: { ...CAL, id: 'OTHERCAL99999', locationId: 'LOC_KEIZER' } }
    if (/\/free-slots$/.test(p)) return { '2026-11-20': { slots: ['2026-11-20T17:00:00-08:00'] }, traceId: 'x' }
    if (p === '/contacts/upsert') return { contact: { id: 'NEWCONTACT1' } }
    if (p === '/calendars/events/appointments') return { id: 'APPT1', startTime: opts.body.startTime }
    throw new Error(`unexpected ${p}`)
  },
})

// The booking limit (6/min per IP) is real protection in production; here it
// would just cap how many cases one file can run.
{
  const file = require.resolve('express-rate-limit')
  require.cache[file] = { id: file, filename: file, loaded: true, exports: () => (req, res, next) => next() }
}
const router = require('./tourBooking')
const app = express()
app.use(express.json())
app.use('/tour', router)

async function call(method, urlPath, body) {
  const server = app.listen(0)
  const { port } = server.address()
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ port, path: urlPath, method, headers: { 'Content-Type': 'application/json' } }, r => {
        let b = ''; r.on('data', c => (b += c)); r.on('end', () => resolve({ status: r.statusCode, body: b }))
      })
      req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end()
    })
  } finally { server.close() }
}
const json = r => (r.body ? JSON.parse(r.body) : null)

const TYPED = { location: 'salem', startTime: '2026-11-20T17:00:00-08:00', firstName: 'Sam', lastName: 'Lee', phone: '5035550100', email: 'sam@example.com' }

// The router caches each club's calendar; tests that change config call
// /api/config?refresh=1 first to drop it.
beforeEach(() => {
  calls = []
  config = { tour_url_salem: `https://api.westcoaststrength.com/widget/booking/${CAL.id}` }
})

test('calendarIdFromUrl reads a GHL widget link and nothing else', () => {
  assert.equal(router.calendarIdFromUrl('https://api.westcoaststrength.com/widget/booking/DnZ9gBjTiqWNWLQzVPEF'), 'DnZ9gBjTiqWNWLQzVPEF')
  assert.equal(router.calendarIdFromUrl('https://api.westcoaststrength.com/widget/booking/DnZ9gBjTiqWNWLQzVPEF?x=1'), 'DnZ9gBjTiqWNWLQzVPEF')
  assert.equal(router.calendarIdFromUrl('https://book.westcoaststrength.com/tour/salem'), null)
  assert.equal(router.calendarIdFromUrl(null), null)
})

test('config uses the tour calendar from the Tour action link', async () => {
  const r = await call('GET', '/tour/api/config?location=salem&refresh=1')
  assert.equal(r.status, 200, r.body)
  assert.deepEqual(json(r).calendar, { id: CAL.id, name: 'Salem Gym Tour', minutes: 15 })
})

test('tour_calendar_<slug> wins over the action link', async () => {
  config.tour_url_salem = 'https://book.westcoaststrength.com/tour/salem'
  config.tour_calendar_salem = CAL.id
  const r = await call('GET', '/tour/api/config?location=salem&refresh=1')
  assert.equal(r.status, 200, r.body)
  assert.equal(json(r).calendar.id, CAL.id)
})

test('a calendar from another GHL account is refused', async () => {
  config.tour_calendar_salem = 'OTHERCAL99999'
  const r = await call('GET', '/tour/api/config?location=salem&refresh=1')
  assert.equal(r.status, 502)
})

test('no calendar set says so', async () => {
  config = {}
  const r = await call('GET', '/tour/api/config?location=salem&refresh=1')
  assert.equal(r.status, 404)
  assert.match(json(r).error, /No tour calendar/)
})

test('slots come back keyed by date', async () => {
  await call('GET', '/tour/api/config?location=salem&refresh=1')
  const r = await call('GET', '/tour/api/slots?location=salem&days=31')
  assert.equal(r.status, 200, r.body)
  assert.deepEqual(json(r).days, { '2026-11-20': ['2026-11-20T17:00:00-08:00'] })
})

test('typed booking needs all four fields', async () => {
  for (const drop of ['firstName', 'lastName', 'phone', 'email']) {
    const r = await call('POST', '/tour/api/book', { ...TYPED, [drop]: '' })
    assert.equal(r.status, 400, drop)
  }
  const bad = await call('POST', '/tour/api/book', { ...TYPED, email: 'not-an-email' })
  assert.equal(bad.status, 400)
  assert.ok(!calls.some(c => c.method !== 'GET'), 'nothing written')
})

test('typed booking upserts the contact and books the tour calendar with notifications', async () => {
  await call('GET', '/tour/api/config?location=salem&refresh=1')
  const r = await call('POST', '/tour/api/book', TYPED)
  assert.equal(r.status, 200, r.body)
  const up = calls.find(c => c.path === '/contacts/upsert')
  assert.deepEqual(up.body, { locationId: 'LOC_SALEM', firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', phone: '5035550100' })
  const appt = calls.find(c => c.path === '/calendars/events/appointments')
  assert.equal(appt.body.calendarId, CAL.id)
  assert.equal(appt.body.contactId, 'NEWCONTACT1')
  assert.equal(appt.body.toNotify, true)
  assert.equal(appt.body.title, 'Gym Tour - Sam Lee')
  assert.equal(new Date(appt.body.endTime) - new Date(appt.body.startTime), 15 * 60000)
  assert.ok(!('assignedUserId' in appt.body), 'GHL assigns the calendar owner')
})

test('personal link: prefill shows first name + last initial only', async () => {
  const r = await call('GET', '/tour/api/prefill?location=salem&c=abc123def456')
  assert.equal(r.status, 200)
  assert.deepEqual(json(r), { firstName: 'Jane', lastInitial: 'D' })
  for (const c of ['other999other9', 'nope00000000', '../x', '']) {
    assert.equal((await call('GET', `/tour/api/prefill?location=salem&c=${encodeURIComponent(c)}`)).status, 404, c)
  }
})

test('personal link books that contact with no upsert, name from GHL', async () => {
  await call('GET', '/tour/api/config?location=salem&refresh=1')
  const r = await call('POST', '/tour/api/book', { location: 'salem', startTime: TYPED.startTime, contactId: 'abc123def456', firstName: 'Spoof' })
  assert.equal(r.status, 200, r.body)
  assert.ok(!calls.some(c => c.path === '/contacts/upsert'), 'no upsert')
  const appt = calls.find(c => c.path === '/calendars/events/appointments')
  assert.equal(appt.body.contactId, 'abc123def456')
  assert.equal(appt.body.title, 'Gym Tour - Jane doe')
})

test('another club\'s contact id is refused before anything is written', async () => {
  const r = await call('POST', '/tour/api/book', { location: 'salem', startTime: TYPED.startTime, contactId: 'other999other9' })
  assert.equal(r.status, 400)
  assert.equal(json(r).error, 'contact_not_found')
  assert.ok(!calls.some(c => c.method !== 'GET'))
})

test('"Not you?": no contactId, so the typed person is upserted and booked', async () => {
  await call('GET', '/tour/api/config?location=salem&refresh=1')
  const r = await call('POST', '/tour/api/book', TYPED)
  assert.equal(r.status, 200, r.body)
  assert.ok(!calls.some(c => c.path === '/contacts/abc123def456'))
  assert.equal(calls.find(c => c.path === '/calendars/events/appointments').body.contactId, 'NEWCONTACT1')
})

test('the per-club page renders with the mount base and club baked in', async () => {
  const r = await call('GET', '/tour/salem')
  assert.equal(r.status, 200)
  assert.match(r.body, /var API = '\/tour'/)
  assert.match(r.body, /location: 'salem'/)
  assert.ok(!r.body.includes('{{WIDGET_'), 'no unfilled placeholders')
  assert.equal((await call('GET', '/tour/nowhere')).status, 404)
})
