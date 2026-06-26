const test = require('node:test')
const assert = require('node:assert')
const Module = require('module')

// Stub ../services/permissions. marketingContext lazy-requires it at call time,
// so the stub must stay installed through the tests; restored in after().
const origLoad = Module._load
Module._load = function (request) {
  if (request === '../services/permissions') {
    return { getEffectivePermissions: async (staff) => staff.__perms || [] }
  }
  return origLoad.apply(this, arguments)
}
test.after(() => { Module._load = origLoad })

const { marketingContext, requireMarketing, requireMarketingCapability } = require('./role')

function run(mw, staff) {
  return new Promise(resolve => {
    let status = 200
    const req = { staff }
    const res = { status: (c) => { status = c; return res }, json: () => resolve({ status, req }) }
    mw(req, res, () => resolve({ status: 'next', req }))
  })
}

test('marketingContext: corporate tier grants all caps, unrestricted types', async () => {
  const ctx = await marketingContext({ role: 'corporate' })
  assert.deepStrictEqual([...ctx.capabilities].sort(), ['needs', 'research', 'tracker'])
  assert.deepStrictEqual(ctx.types, []) // [] = unrestricted (corporate is full tier)
})

test('marketingContext: add-on grants all caps and preserves legacy type scope', async () => {
  const ctx = await marketingContext({ role: 'team_member', marketing_addon: true, marketing_types: ['flyer'] })
  assert.deepStrictEqual([...ctx.capabilities].sort(), ['needs', 'research', 'tracker'])
  assert.deepStrictEqual(ctx.types, ['flyer'])
})

test('marketingContext: role grants only the toggled caps + granted types', async () => {
  const ctx = await marketingContext({ role: 'lead', __perms: ['marketing:tracker', 'marketing_type:meta_ad'] })
  assert.deepStrictEqual([...ctx.capabilities].sort(), ['tracker'])
  assert.deepStrictEqual(ctx.types, ['meta_ad'])
})

test('marketingContext: no access yields no caps', async () => {
  const ctx = await marketingContext({ role: 'team_member', __perms: [] })
  assert.strictEqual(ctx.capabilities.size, 0)
})

test('requireMarketing: blocks with 403 when no capability', async () => {
  const { status } = await run(requireMarketing, { role: 'team_member', __perms: [] })
  assert.strictEqual(status, 403)
})

test('requireMarketing: passes and enriches req.staff.marketing_types', async () => {
  const { status, req } = await run(requireMarketing, { role: 'lead', __perms: ['marketing:tracker', 'marketing_type:sms'] })
  assert.strictEqual(status, 'next')
  assert.deepStrictEqual(req.staff.marketing_types, ['sms'])
  assert.ok(req.marketingCaps.has('tracker'))
})

test('requireMarketingCapability: enforces the specific cap', async () => {
  const caps = new Set(['tracker'])
  const ok = await new Promise(resolve => {
    requireMarketingCapability('tracker')({ marketingCaps: caps }, { status: () => ({ json: () => resolve(403) }) }, () => resolve('next'))
  })
  assert.strictEqual(ok, 'next')
  const blocked = await new Promise(resolve => {
    requireMarketingCapability('needs')({ marketingCaps: caps }, { status: (c) => ({ json: () => resolve(c) }) }, () => resolve('next'))
  })
  assert.strictEqual(blocked, 403)
})
