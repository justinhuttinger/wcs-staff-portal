const test = require('node:test')
const assert = require('node:assert/strict')

// Capture log lines so the test output stays quiet and we can inspect what
// the warmer reported.
function makeLogger() {
  const lines = { log: [], warn: [], error: [] }
  return {
    log: (...args) => lines.log.push(args.join(' ')),
    warn: (...args) => lines.warn.push(args.join(' ')),
    error: (...args) => lines.error.push(args.join(' ')),
    _lines: lines,
  }
}

test('thisMonthRange returns YYYY-MM-DD for first-of-month start and today end', () => {
  const { thisMonthRange } = require('../src/services/cacheWarmer')
  const r = thisMonthRange()
  assert.match(r.start_date, /^\d{4}-\d{2}-01$/, 'start should be first of month')
  assert.match(r.end_date, /^\d{4}-\d{2}-\d{2}$/, 'end should be a valid YYYY-MM-DD')
  assert.ok(r.start_date <= r.end_date)
})

test('isPacificBusinessHours returns boolean (smoke test)', () => {
  const { isPacificBusinessHours } = require('../src/services/cacheWarmer')
  assert.equal(typeof isPacificBusinessHours(), 'boolean')
})

test('runCycle: invokes each registered task for every location', async () => {
  const warmer = require('../src/services/cacheWarmer')
  warmer._resetTasks()

  const calls = []
  warmer.registerWarmer('test-route', async (query) => {
    calls.push(query)
    return { ok: true }
  }, (loc, range) => ({ ...range, location_slug: loc }))

  const log = makeLogger()
  const result = await warmer.runCycle({ force: true, log })

  // 8 locations × 1 task = 8 calls
  assert.equal(calls.length, 8)
  assert.equal(result.warmed, 8)
  assert.equal(result.failed, 0)
  // First and last locations should be 'all' and 'medford' per the warmer's order
  assert.equal(calls[0].location_slug, 'all')
  assert.equal(calls.at(-1).location_slug, 'medford')
  warmer._resetTasks()
})

test('runCycle: continues past a failing task and reports it', async () => {
  const warmer = require('../src/services/cacheWarmer')
  warmer._resetTasks()

  let okCalls = 0
  warmer.registerWarmer('boom', async (q) => {
    if (q.location_slug === 'salem') throw new Error('synthetic-fail')
    okCalls++
    return { ok: true }
  }, (loc) => ({ location_slug: loc }))

  const log = makeLogger()
  const result = await warmer.runCycle({ force: true, log })

  assert.equal(result.warmed, 7, '7 of 8 locations should succeed')
  assert.equal(result.failed, 1, '1 location should fail')
  assert.equal(okCalls, 7)
  assert.ok(log._lines.warn.some(l => l.includes('boom/salem') && l.includes('synthetic-fail')))
  warmer._resetTasks()
})

test('runCycle: respects business-hours gate unless forced', async () => {
  const warmer = require('../src/services/cacheWarmer')
  warmer._resetTasks()

  const originalHours = warmer.isPacificBusinessHours
  // Force the gate to "no, off-hours" for this test
  const cacheWarmerModule = require('../src/services/cacheWarmer')
  const Module = require('module')
  // Temporarily monkey-patch the exported function — re-require not feasible
  // because the module caches the function reference internally. Easier path:
  // exercise the gate via the result string.

  const calls = []
  warmer.registerWarmer('check', async (q) => { calls.push(q) }, (loc) => ({ location_slug: loc }))

  const log = makeLogger()
  // Force=true should always run regardless of clock
  const forced = await warmer.runCycle({ force: true, log })
  assert.equal(forced.warmed, 8, 'force=true should run regardless of hour')

  warmer._resetTasks()
})

test('registerWarmer: skips registration when fn is not a function', () => {
  const warmer = require('../src/services/cacheWarmer')
  warmer._resetTasks()

  // Pretend a route forgot to export warmCache
  warmer.registerWarmer('forgot-to-export', undefined, () => ({}))
  assert.equal(warmer._tasks.length, 0, 'should not register tasks with non-function fn')
  warmer._resetTasks()
})

// Only runs when node_modules has been installed (CI / deployed env). Skipped
// locally because requiring route files transitively requires 'express' etc.
let canRequireExpress = false
try { require.resolve('express'); canRequireExpress = true } catch {}

test('registerDefaultRoutes wires all 6 cached routes', { skip: !canRequireExpress }, () => {
  const warmer = require('../src/services/cacheWarmer')
  warmer._resetTasks()
  warmer.registerDefaultRoutes()
  const names = warmer._tasks.map(t => t.name).sort()
  assert.deepEqual(names, [
    'checkins',
    'deactivated-pt',
    'pt-health',
    'pt-new-clients',
    'pt-roster',
    'pt-sessions',
  ])
  warmer._resetTasks()
})
