// Drip test SMS: {{contact.id}} (inside a custom value such as a personal Day One
// link) is filled with the test phone's own contact at that club, so the link in
// the test actually opens for the person who receives it.
const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const http = require('http')
const express = require('express')

const LOC = { slug: 'salem', name: 'Salem', id: 'LOC_SALEM', apiKey: 'key' }

function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}

let calls = []
let phoneOwner = 'CONTACT_TESTER1'
stub('../middleware/auth', (req, res, next) => { req.staff = { id: 'S1', role: 'admin', email: 'a@b.co' }; next() })
stub('../middleware/tile', { requireTile: () => (req, res, next) => next() })
stub('../config/ghlLocations', { LOCATIONS: [LOC], getLocationBySlug: s => (s === 'salem' ? LOC : null) })
stub('../services/auditLog', { record: async () => {} })
stub('../services/supabase', {
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        in: async () => ({ data: [{ key: 'drip_test_webhook_url', value: 'https://hooks.example.com/test' }], error: null }),
      }),
    }),
  },
})
stub('../services/ghlClient', {
  sleep: async () => {},
  ghlFetch: async (p, key, opts = {}) => {
    calls.push({ path: p, params: opts.params })
    if (p === `/locations/${LOC.id}/customValues`) {
      return { customValues: [{ fieldKey: '{{ custom_values.dayone_link }}', value: 'https://book.westcoaststrength.com/dayone/salem?c={{contact.id}}' }] }
    }
    if (p === '/contacts/search/duplicate') {
      return opts.params.number && phoneOwner ? { contact: { id: phoneOwner } } : { contact: null }
    }
    throw new Error(`unexpected ${p}`)
  },
})

const sentToHook = []
const realFetch = global.fetch
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://hooks.example.com/')) {
    sentToHook.push(JSON.parse(init.body))
    return new Response('ok', { status: 200 })
  }
  return realFetch(url, init)
}
after(() => { global.fetch = realFetch })

const app = express()
app.use(express.json())
app.use('/custom-values', require('./customValues'))

async function post(urlPath, body) {
  const server = app.listen(0)
  const { port } = server.address()
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ port, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/json' } }, r => {
        let b = ''; r.on('data', c => (b += c)); r.on('end', () => resolve({ status: r.statusCode, json: b ? JSON.parse(b) : null }))
      })
      req.on('error', reject); req.write(JSON.stringify(body)); req.end()
    })
  } finally { server.close() }
}

beforeEach(() => { calls = []; sentToHook.length = 0; phoneOwner = 'CONTACT_TESTER1' })

const TEXT = 'Hi {{contact.first_name}}, book here: {{custom_values.dayone_link}}'

test('contact.id inside a custom value becomes the test phone\'s contact at that club', async () => {
  const r = await post('/custom-values/test-sms', { location: 'salem', text: TEXT, phone: '503-555-0100' })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.testContactId, 'CONTACT_TESTER1')
  assert.deepEqual(r.json.unresolved, [])
  assert.equal(sentToHook[0].message, 'Hi Alex, book here: https://book.westcoaststrength.com/dayone/salem?c=CONTACT_TESTER1')
  const lookup = calls.find(c => c.path === '/contacts/search/duplicate' && c.params.number)
  assert.equal(lookup.params.locationId, 'LOC_SALEM')
  assert.equal(lookup.params.number, '+15035550100')
})

test('no contact with that phone: contact.id stays unresolved and is reported', async () => {
  phoneOwner = null
  const r = await post('/custom-values/test-sms', { location: 'salem', text: TEXT, phone: '5035550100' })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.testContactId, null)
  assert.deepEqual(r.json.unresolved, ['contact.id'])
})

test('no lookup when the message does not use contact.id', async () => {
  const r = await post('/custom-values/test-sms', { location: 'salem', text: 'Hi {{contact.first_name}}', phone: '5035550100' })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.ok(!calls.some(c => c.path === '/contacts/search/duplicate'))
  assert.equal(sentToHook[0].message, 'Hi Alex')
})
