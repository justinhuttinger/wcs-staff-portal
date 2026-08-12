const test = require('node:test')
const assert = require('node:assert')
const Module = require('module')
const fs = require('node:fs')
const path = require('node:path')

// Regression: a drawer count must reach till_counts regardless of whether the
// Operandio job carries points.
//
// The webhook used to run the audit branch first, gated only on the body's
// "Overall score N M P%". Drawer counts fell through to the till branch purely
// because an unscored job renders "Overall score 0 0 %". When a scored step was
// added to the Drawer Close Count job (Jul 2026) its emails started rendering
// "Overall score 1 1 100%", the audit branch matched and returned early, and
// every close count silently became a QA audit row: the Till report showed no
// closing count and the till-close auto-print never fired.
//
// Externals are stubbed via Module._load (same pattern as the change-password
// route tests) so the router can be required without node_modules. The till
// parser and its fixtures are REAL — the point is the branch order.

const closeHtml = fs.readFileSync(path.join(__dirname, '../lib/__fixtures__/till-close-count.html'), 'utf8')

// The fixture body is unscored. This is the scored body Operandio now sends for
// the same job; only the score line differs.
const SCORED_TEXT = 'Drawer Close Count\r\nOverall score 1 1 100%\r\nView job ( https://app.operandio.com/job/abc )\r\n'
const UNSCORED_TEXT = 'Drawer Close Count\r\nOverall score 0 0 %\r\nView job ( https://app.operandio.com/job/abc )\r\n'

const routes = []
const fakeRouter = () => {
  const r = { use: () => {} }
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    r[m] = (p, ...handlers) => routes.push({ method: m, path: p, handlers })
  }
  return r
}

// Every table write the route makes, in order.
const writes = []

const tableStub = (table) => ({
  insert: (row) => {
    writes.push({ table, op: 'insert', row })
    return {
      select: () => ({ single: async () => ({ data: { id: 'raw-1' }, error: null }) }),
    }
  },
  upsert: async (row) => {
    writes.push({ table, op: 'upsert', row })
    return { error: null }
  },
})

const supabaseStub = {
  from: tableStub,
  storage: { from: () => ({ upload: async () => ({ error: null }) }) },
}

// The route captures the secret at module load, so set it before requiring.
process.env.OPERANDIO_WEBHOOK_SECRET = 'test-secret'

const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'express') return { Router: fakeRouter }
  if (request === 'multer') {
    const m = () => ({ any: () => (req, res, next) => next() })
    m.memoryStorage = () => ({})
    return m
  }
  if (request === '../services/supabase') return { supabaseAdmin: supabaseStub }
  if (request === '../middleware/auth') return (req, res, next) => next()
  if (request === '../middleware/role') {
    return { requireRole: () => (req, res, next) => next(), requireReportAccess: () => (req, res, next) => next(), canSeeAllLocations: () => true }
  }
  if (request === '../services/locationScope') return { resolveScopedSlugs: async () => [] }
  if (request === '../services/printing/tillReceipt') {
    return { maybeEnqueueTillReceipt: async () => { writes.push({ table: '_print', op: 'enqueue' }); return { enqueued: true, jobId: 'p1' } } }
  }
  if (request === '../services/printing/loadReconciliation') return { loadReconciliation: async () => ({}) }
  return origLoad.apply(this, arguments)
}

require('./operandio')
Module._load = origLoad

const webhook = routes.find(r => r.method === 'post' && r.path === '/webhook')

// Drive the handler directly; the multer stub is a no-op so req.body stands in
// for the parsed multipart form.
async function post({ subject, text, html }) {
  writes.length = 0
  const req = { query: { secret: process.env.OPERANDIO_WEBHOOK_SECRET }, body: { subject, text, html, from: 'noreply@operandio.com' }, files: [] }
  let payload = null, status = 200
  const res = {
    status(s) { status = s; return this },
    json(p) { payload = p; return this },
  }
  const handler = webhook.handlers[webhook.handlers.length - 1]
  await handler(req, res)
  return { status, payload, writes: writes.slice() }
}

test('webhook is registered', () => {
  assert.ok(webhook, 'POST /webhook route not found')
})

test('a SCORED drawer close count still lands in till_counts, not qa_reports', async () => {
  const { payload, writes: w } = await post({
    subject: 'Drawer Close Count (Drawer Open Count) submitted at Salem',
    text: SCORED_TEXT,
    html: closeHtml,
  })
  assert.equal(payload?.tillCount, true, 'expected a till count response')
  assert.equal(payload.count_type, 'close')
  const tables = w.filter(x => x.op === 'upsert').map(x => x.table)
  assert.ok(tables.includes('till_counts'), 'till_counts was not written')
  assert.ok(!tables.includes('operandio_qa_reports'), 'scored drawer count leaked into operandio_qa_reports')
})

test('a scored drawer CLOSE count still triggers the receipt print', async () => {
  const { writes: w } = await post({
    subject: 'Drawer Close Count (Drawer Open Count) submitted at Salem',
    text: SCORED_TEXT,
    html: closeHtml,
  })
  assert.ok(w.some(x => x.table === '_print'), 'till-close auto-print was not enqueued')
})

test('an UNSCORED drawer close count behaves identically', async () => {
  const { payload } = await post({
    subject: 'Drawer Close Count (Jun 29) submitted at Salem',
    text: UNSCORED_TEXT,
    html: closeHtml,
  })
  assert.equal(payload?.tillCount, true)
  assert.equal(payload.count_type, 'close')
})

test('a real scored audit is still stored as an audit', async () => {
  const { payload, writes: w } = await post({
    subject: 'QA-Cleaning (Jun 5) submitted at Salem',
    text: 'QA-Cleaning\r\nOverall score 370 215 58%\r\n',
    html: '<html><body>no drawer rows here</body></html>',
  })
  assert.equal(payload?.audit, true, 'expected an audit response')
  assert.equal(payload.score_pct, 58)
  const tables = w.filter(x => x.op === 'upsert').map(x => x.table)
  assert.ok(tables.includes('operandio_qa_reports'), 'audit was not written')
  assert.ok(!tables.includes('till_counts'), 'audit leaked into till_counts')
})
