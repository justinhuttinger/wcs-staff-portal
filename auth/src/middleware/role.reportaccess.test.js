const test = require('node:test')
const assert = require('node:assert')
const Module = require('module')

// Stub ../services/permissions. requireReportAccess lazy-requires it at call
// time (to avoid a require cycle), so the stub must remain installed through
// the test calls and is restored in an after() hook.
const origLoad = Module._load
Module._load = function (request) {
  if (request === '../services/permissions') {
    return { getEffectivePermissions: async (staff) => staff.__perms || [] }
  }
  return origLoad.apply(this, arguments)
}
test.after(() => { Module._load = origLoad })

const { requireReportAccess } = require('./role')

function run(mw, staff) {
  return new Promise(resolve => {
    let status = 200
    const res = { status: (c) => { status = c; return res }, json: () => resolve(status) }
    mw({ staff }, res, () => resolve('next'))
  })
}

test('tier-eligible role still passes (parity)', async () => {
  const mw = requireReportAccess('manager', ['kpis'])
  assert.strictEqual(await run(mw, { role: 'manager' }), 'next')
})

test('below-tier role with an effective report grant passes', async () => {
  const mw = requireReportAccess('manager', ['kpis'])
  assert.strictEqual(await run(mw, { role: 'lead', __perms: ['report:kpis'] }), 'next')
})

test('below-tier role without the grant is blocked', async () => {
  const mw = requireReportAccess('manager', ['kpis'])
  assert.strictEqual(await run(mw, { role: 'lead', __perms: [] }), 403)
})
