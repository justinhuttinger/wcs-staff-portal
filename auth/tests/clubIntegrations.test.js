// Tests for /admin/club-integrations.
//
// Supabase and the auth middleware are stubbed by priming require.cache before
// the router loads, so this exercises the real express handlers without a
// database or a JWT.

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const express = require('express')

// --- stubs ------------------------------------------------------------------

let tableRows = []
let tableError = null
let lastUpsert = null

function stubQuery() {
  const result = { data: tableRows, error: tableError }
  const chain = {
    select: () => chain,
    order: () => Promise.resolve(result),
    upsert: (patch, opts) => {
      lastUpsert = { patch, opts }
      return Promise.resolve({ error: tableError })
    },
  }
  return chain
}

function prime(relPath, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', relPath))
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
}

prime('services/supabase', { supabaseAdmin: { from: () => stubQuery() } })
prime('middleware/auth', (req, res, next) => {
  req.staff = { id: 'staff-uuid-1', role: 'admin' }
  next()
})
prime('middleware/role', { requireRole: () => (req, res, next) => next() })

const router = require('../src/routes/clubIntegrationsAdmin')

// --- harness ----------------------------------------------------------------

const app = express()
app.use(express.json())
app.use('/admin/club-integrations', router)

let server
let base

test.before(async () => {
  server = http.createServer(app)
  await new Promise(res => server.listen(0, res))
  base = `http://127.0.0.1:${server.address().port}`
})

test.after(() => server && server.close())

test.beforeEach(() => {
  tableRows = []
  tableError = null
  lastUpsert = null
})

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body))
    const req = http.request(
      `${base}${urlPath}`,
      {
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : {},
      },
      res => {
        let raw = ''
        res.on('data', c => (raw += c))
        res.on('end', () => {
          let json = null
          try { json = JSON.parse(raw) } catch { /* non-JSON */ }
          resolve({ status: res.statusCode, body: json })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const ALL_CLUBS = ['30935', '31599', '7655', '31598', '31600', '31601', '32073']

// --- GET --------------------------------------------------------------------

test('GET lists all seven clubs even when the table is empty', async () => {
  const res = await request('GET', '/admin/club-integrations')

  assert.equal(res.status, 200)
  assert.equal(res.body.clubs.length, 7)
  assert.deepEqual(
    res.body.clubs.map(c => c.abc_club_number).sort(),
    [...ALL_CLUBS].sort()
  )
  // Empty strings, not nulls — the inputs are controlled and React warns on
  // a value flipping from null to a string.
  for (const club of res.body.clubs) {
    assert.equal(club.kiosk_waiver_lead_webhook_url, '')
    assert.equal(club.pt_intake_webhook_url, '')
  }
})

test('GET merges stored rows over the club list', async () => {
  tableRows = [
    {
      abc_club_number: '30935',
      location_slug: 'salem',
      display_name: 'Salem',
      kiosk_waiver_lead_webhook_url: 'https://hooks.example.test/lead',
      kiosk_waiver_completed_webhook_url: 'https://hooks.example.test/done',
      pt_intake_webhook_url: null,
      active: true,
      updated_at: '2026-08-24T00:00:00.000Z',
    },
  ]

  const res = await request('GET', '/admin/club-integrations')
  const salem = res.body.clubs.find(c => c.abc_club_number === '30935')
  const keizer = res.body.clubs.find(c => c.abc_club_number === '31599')

  assert.equal(salem.kiosk_waiver_lead_webhook_url, 'https://hooks.example.test/lead')
  assert.equal(salem.kiosk_waiver_completed_webhook_url, 'https://hooks.example.test/done')
  assert.equal(salem.pt_intake_webhook_url, '', 'nulls come back as empty strings')
  assert.equal(keizer.kiosk_waiver_lead_webhook_url, '', 'clubs with no row still render')
})

test('GET degrades to an editable page when migration 075 has not run', async () => {
  tableError = { message: 'relation "club_integrations" does not exist' }

  const res = await request('GET', '/admin/club-integrations')

  assert.equal(res.status, 200, 'a missing table is a warning, not a 500')
  assert.equal(res.body.clubs.length, 7)
  assert.match(res.body.warning, /migration 075/)
})

// --- PUT --------------------------------------------------------------------

test('PUT saves a club and carries the NOT NULL columns', async () => {
  const res = await request('PUT', '/admin/club-integrations/30935', {
    kiosk_waiver_lead_webhook_url: 'https://services.leadconnectorhq.com/hooks/abc/webhook-trigger/1',
  })

  assert.equal(res.status, 200)
  assert.equal(res.body.message, 'Saved')

  // Postgres validates NOT NULL on the candidate insert row even for
  // ON CONFLICT DO UPDATE, so omitting these 500s the first save for a club.
  assert.equal(lastUpsert.patch.location_slug, 'salem')
  assert.equal(lastUpsert.patch.display_name, 'Salem')
  assert.equal(lastUpsert.patch.abc_club_number, '30935')
  assert.equal(lastUpsert.opts.onConflict, 'abc_club_number')

  assert.equal(lastUpsert.patch.updated_by, 'staff-uuid-1', 'writes are attributed')
  assert.equal(
    lastUpsert.patch.kiosk_waiver_lead_webhook_url,
    'https://services.leadconnectorhq.com/hooks/abc/webhook-trigger/1'
  )
})

test('PUT only touches the fields it was sent', async () => {
  await request('PUT', '/admin/club-integrations/31599', {
    pt_intake_webhook_url: 'https://hooks.example.test/pt',
  })

  assert.ok('pt_intake_webhook_url' in lastUpsert.patch)
  assert.ok(
    !('kiosk_waiver_lead_webhook_url' in lastUpsert.patch),
    'an unsent field must not be nulled out'
  )
})

test('PUT clears a field when sent an empty string', async () => {
  await request('PUT', '/admin/club-integrations/31599', {
    pt_intake_webhook_url: '',
  })

  assert.equal(lastUpsert.patch.pt_intake_webhook_url, null, 'empty means "no webhook"')
})

test('PUT rejects a URL that would never fire', async () => {
  for (const bad of ['not-a-url', 'http://hooks.example.test/insecure', 'services.leadconnectorhq.com/hooks/x']) {
    const res = await request('PUT', '/admin/club-integrations/30935', {
      kiosk_waiver_lead_webhook_url: bad,
    })
    assert.equal(res.status, 400, `${bad} should be rejected`)
    assert.ok(res.body.fields.kiosk_waiver_lead_webhook_url)
  }
  assert.equal(lastUpsert, null, 'nothing reaches the database')
})

test('PUT refuses a club number that is not ours', async () => {
  const res = await request('PUT', '/admin/club-integrations/99999', {
    pt_intake_webhook_url: 'https://hooks.example.test/x',
  })

  assert.equal(res.status, 404)
  assert.equal(lastUpsert, null)
})

test('PUT surfaces a database failure instead of reporting success', async () => {
  tableError = { message: 'permission denied' }

  const res = await request('PUT', '/admin/club-integrations/30935', {
    pt_intake_webhook_url: 'https://hooks.example.test/x',
  })

  assert.equal(res.status, 500)
  assert.equal(res.body.error, 'Failed to save')
})
