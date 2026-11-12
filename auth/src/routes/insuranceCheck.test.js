// Insurance check page: per-club programs (defaults until an admin saves), the
// admin-only read/save, and the page render.
const { test, beforeEach } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const http = require('http')
const express = require('express')

function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}

const CLUBS = [
  { slug: 'salem', name: 'Salem' },
  { slug: 'eugene', name: 'Eugene' },
  { slug: 'wilsonville', name: 'Wilsonville' },
]
let rows = {}
let role = 'admin'
stub('../config/clubs', { CLUBS })
stub('../middleware/auth', (req, res, next) => { req.staff = { id: 'S1', role }; next() })
stub('../middleware/role', {
  requireRole: min => (req, res, next) => (req.staff.role === min ? next() : res.status(403).json({ error: 'Forbidden' })),
})
stub('../services/supabase', {
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        like: async (col, pattern) => {
          const prefix = pattern.replace('%', '')
          return { data: Object.entries(rows).filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })), error: null }
        },
      }),
      upsert: async list => { for (const r of list) rows[r.key] = r.value; return { error: null } },
    }),
  },
})
{
  const file = require.resolve('express-rate-limit')
  require.cache[file] = { id: file, filename: file, loaded: true, exports: () => (req, res, next) => next() }
}

const router = require('./insuranceCheck')
const app = express()
app.use(express.json())
app.use('/insurance', router)

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
const json = r => JSON.parse(r.body)
const keys = r => json(r).programs.map(p => p.key)

// Each test starts from "no rows saved"; a save clears the route's cache, and
// the admin read always reads fresh.
beforeEach(async () => { rows = {}; role = 'admin'; await call('PUT', '/insurance/api/admin', { clubs: {} }) })

test('defaults match the old pages: Optum + ASH everywhere, Silver Sneakers at Eugene', async () => {
  assert.deepEqual(keys(await call('GET', '/insurance/api/programs?club=salem')), ['optum', 'ash'])
  assert.deepEqual(keys(await call('GET', '/insurance/api/programs?club=eugene')), ['optum', 'silversneakers', 'ash'])
  const p = json(await call('GET', '/insurance/api/programs?club=salem')).programs[0]
  assert.deepEqual(Object.keys(p).sort(), ['key', 'name', 'url'])
})

test('unknown club is refused', async () => {
  assert.equal((await call('GET', '/insurance/api/programs?club=nowhere')).status, 400)
})

test('admin save sets a club\'s programs, in catalog order, unknown keys dropped', async () => {
  const r = await call('PUT', '/insurance/api/admin', { clubs: { wilsonville: ['ash', 'bogus', 'silversneakers'], salem: [] } })
  assert.equal(r.status, 200, r.body)
  assert.equal(rows.insurance_programs_wilsonville, 'silversneakers,ash')
  assert.equal(rows.insurance_programs_salem, '')
  assert.deepEqual(keys(await call('GET', '/insurance/api/programs?club=wilsonville')), ['silversneakers', 'ash'])
  assert.deepEqual(keys(await call('GET', '/insurance/api/programs?club=salem')), [], 'saved empty = none, not defaults')
})

test('admin read shows every club with defaults applied', async () => {
  await call('PUT', '/insurance/api/admin', { clubs: { salem: ['optum'] } })
  const d = json(await call('GET', '/insurance/api/admin'))
  assert.deepEqual(d.programs.map(p => p.key), ['optum', 'silversneakers', 'ash'])
  assert.deepEqual(d.clubs.map(c => [c.slug, c.programs]), [
    ['salem', ['optum']], ['eugene', ['optum', 'silversneakers', 'ash']], ['wilsonville', ['optum', 'ash']],
  ])
})

test('admin routes refuse non-admins and unknown clubs', async () => {
  role = 'manager'
  assert.equal((await call('GET', '/insurance/api/admin')).status, 403)
  assert.equal((await call('PUT', '/insurance/api/admin', { clubs: { salem: [] } })).status, 403)
  role = 'admin'
  assert.equal((await call('PUT', '/insurance/api/admin', { clubs: { nowhere: ['optum'] } })).status, 400)
  assert.equal((await call('PUT', '/insurance/api/admin', { clubs: ['optum'] })).status, 400)
})

test('the per-club page renders with base and club baked in; unknown club 404s', async () => {
  const r = await call('GET', '/insurance/wilsonville')
  assert.equal(r.status, 200)
  assert.match(r.body, /var CLUB = 'wilsonville'/)
  assert.match(r.body, /src="\/insurance\/logo.png"/)
  assert.ok(!r.body.includes('{{WIDGET_'))
  assert.equal((await call('GET', '/insurance/nowhere')).status, 404)
})
