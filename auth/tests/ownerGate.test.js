const test = require('node:test')
const assert = require('node:assert/strict')
const { onceOwnerGate } = require('../src/lib/ownerGate')

// Runs an array of express-style middleware in order against one request.
async function run(chain, req) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json() { return this } }
  let i = 0
  let reachedEnd = false
  const next = async () => {
    const mw = chain[i++]
    if (!mw) { reachedEnd = true; return }
    await mw(req, res, next)
  }
  await next()
  return { res, reachedEnd }
}

test('the owner check runs once per request even when several Hub routers each apply it', async () => {
  let authCalls = 0
  const gate = onceOwnerGate({
    authenticate: async (req, res, next) => { authCalls++; req.staff = { email: 'owner@example.org', role: 'admin' }; await next() },
    requireAdmin: async (req, res, next) => { await next() },
    ownerEmails: ['owner@example.org'],
  })
  const req = {}
  // Three routers mounted at /hub, each starting with the gate.
  const { reachedEnd } = await run([gate, gate, gate], req)
  assert.equal(reachedEnd, true)
  assert.equal(authCalls, 1)
})

test('a non-owner is refused and the next router still cannot skip the check', async () => {
  let authCalls = 0
  const gate = onceOwnerGate({
    authenticate: async (req, res, next) => { authCalls++; req.staff = { email: 'someone@example.org', role: 'admin' }; await next() },
    requireAdmin: async (req, res, next) => { await next() },
    ownerEmails: ['owner@example.org'],
  })
  const { res, reachedEnd } = await run([gate, gate], {})
  assert.equal(res.statusCode, 403)
  assert.equal(reachedEnd, false)
  assert.equal(authCalls, 1)
})
