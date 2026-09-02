const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const Module = require('node:module')

// ---------------------------------------------------------------------------
// The route, actually run.
//
// WHY THIS EXISTS. This route shipped broken twice over: a `const` was read
// above its own declaration, which is a TEMPORAL DEAD ZONE error. That survives
// `node --check`, the build and every unit test on the pure shaping, because
// none of them execute the handler — it only appears when somebody opens the
// report, as "Failed to build PT roster".
//
// The same class of bug took the whole portal home page down in #852. So the
// handler is exercised here with stubbed I/O: no database, no network, just
// enough to prove the function runs top to bottom and answers 200.
// ---------------------------------------------------------------------------

const base = path.join(__dirname, '..')

const SERVICE = {
  member_id: 'M1', member_name: 'Jane Doe', club_number: '30935',
  trainer_name: 'Katie Castlio', service_item: 'PT 12',
  recurring_type_desc: 'Recurring Service', status: 'active', sub_status: 'Approved',
  frequency: 'Monthly', invoice_total: 200, sale_date: '2026-01-05', inactive_date: null,
}

/** A PostgREST query builder that accepts every filter and returns itself. */
function queryChain() {
  const q = {}
  for (const m of ['select', 'not', 'ilike', 'lte', 'gte', 'in', 'eq', 'order', 'limit']) q[m] = () => q
  return q
}

// Only Router() is needed to reach the handler, and express is not installed in
// every environment this suite runs in.
const expressStub = () => {}
expressStub.Router = () => {
  const stack = []
  const r = {
    stack,
    use() { return r },
    get(...args) {
      const handlers = args.filter(f => typeof f === 'function')
      stack.push({ route: { methods: { get: true }, stack: handlers.map(handle => ({ handle })) } })
      return r
    },
  }
  return r
}

function loadHandler(routeFile) {
  const stubs = {
    express: expressStub,
    [path.join(base, 'services/supabase.js')]: {
      supabaseAdmin: { from: queryChain, rpc: async () => ({ data: [] }) },
    },
    [path.join(base, 'lib/supabaseFetchAll.js')]: { fetchAll: async () => [SERVICE] },
    [path.join(base, 'services/memoryCache.js')]: {
      wrapSWR: async (_k, _f, _s, fn) => fn(),
      wrap: async (_k, _t, fn) => fn(),
    },
    [path.join(base, 'middleware/auth.js')]: (req, res, next) => next(),
    [path.join(base, 'middleware/role.js')]: { requireRole: () => (req, res, next) => next() },
  }

  const origResolve = Module._resolveFilename
  const origLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (stubs[request]) return stubs[request]
    try {
      const resolved = origResolve.call(Module, request, parent, isMain)
      if (stubs[resolved]) return stubs[resolved]
    } catch { /* fall through to the real loader */ }
    return origLoad.apply(Module, arguments)
  }
  try {
    delete require.cache[require.resolve(path.join(base, routeFile))]
    const router = require(path.join(base, routeFile))
    const layer = router.stack.find(l => l.route && l.route.methods.get)
    return layer.route.stack[layer.route.stack.length - 1].handle
  } finally {
    Module._load = origLoad
  }
}

/** Run a handler and resolve to { status, body }. */
function call(handler, query) {
  return new Promise((resolve, reject) => {
    let status = 200
    const res = {
      status(c) { status = c; return this },
      json(body) { resolve({ status, body }) },
    }
    Promise.resolve(handler({ query }, res)).catch(reject)
  })
}

test('the roster handler runs and answers 200', async () => {
  const handler = loadHandler('routes/analyticsPtRoster.js')
  const { status, body } = await call(handler, { clubs: 'all', end: '2026-08-31' })
  assert.equal(status, 200, JSON.stringify(body))
  assert.ok(Array.isArray(body.stats))
  assert.ok(Array.isArray(body.trainers))
})

// The bug: priorAsOf was read by the lookback lines above its own declaration.
test('the as-of and its comparison are both resolved', async () => {
  const handler = loadHandler('routes/analyticsPtRoster.js')
  const { body } = await call(handler, { clubs: 'all', end: '2026-08-31' })
  assert.equal(body.meta.asOf, '2026-08-31')
  assert.equal(body.meta.priorAsOf, '2026-07-31')
  // Twelve months before the as-of, not before today.
  assert.equal(body.meta.pifSince, '2025-08-31')
})

test('with no dates it still runs, defaulting to today', async () => {
  const handler = loadHandler('routes/analyticsPtRoster.js')
  const { status, body } = await call(handler, { clubs: 'all' })
  assert.equal(status, 200, JSON.stringify(body))
  assert.match(body.meta.asOf, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(body.meta.priorAsOf < body.meta.asOf)
})

test('every stat carries a comparison against the month before', async () => {
  const handler = loadHandler('routes/analyticsPtRoster.js')
  const { body } = await call(handler, { clubs: 'all', end: '2026-08-31' })
  for (const s of body.stats) {
    assert.ok('prior' in s, `${s.key} has no comparison`)
  }
})

test('an unknown club is refused rather than silently widened to all', async () => {
  const handler = loadHandler('routes/analyticsPtRoster.js')
  const { status } = await call(handler, { clubs: 'atlantis' })
  assert.equal(status, 400)
})
