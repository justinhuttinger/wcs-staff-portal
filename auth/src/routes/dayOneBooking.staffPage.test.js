// /dayone/<slug>/staff shows the "Booking Team Member" picker; the member link
// /dayone/<slug> doesn't.
const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const http = require('http')
const express = require('express')

const LOC = { slug: 'salem', name: 'Salem', id: 'LOC_SALEM', apiKey: 'key' }
const file = require.resolve(path.join(__dirname, '../config/ghlLocations'))
require.cache[file] = {
  id: file, filename: file, loaded: true,
  exports: { LOCATIONS: [LOC], getLocationBySlug: s => (s === 'salem' ? LOC : null) },
}

const app = express()
app.use('/dayone', require('./dayOneBooking'))

async function get(urlPath) {
  const server = app.listen(0)
  try {
    return await new Promise((resolve, reject) => {
      http.get({ port: server.address().port, path: urlPath }, r => {
        let b = ''; r.on('data', c => (b += c)); r.on('end', () => resolve({ status: r.statusCode, body: b }))
      }).on('error', reject)
    })
  } finally { server.close() }
}

test('staff link turns the team member picker on', async () => {
  const r = await get('/dayone/salem/staff')
  assert.equal(r.status, 200)
  assert.match(r.body, /var STAFF = '1' === '1'/)
  assert.match(r.body, /WIDGET_LOCATION|var S = \{[\s\S]*location: 'salem'/)
})

test('member link leaves it off', async () => {
  const r = await get('/dayone/salem')
  assert.equal(r.status, 200)
  assert.match(r.body, /var STAFF = '' === '1'/)
})

test('unknown club on /staff is a 404, not a blank page', async () => {
  const r = await get('/dayone/nowhere/staff')
  assert.equal(r.status, 404)
})
