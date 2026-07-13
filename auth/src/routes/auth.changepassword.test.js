const test = require('node:test')
const assert = require('node:assert')
const Module = require('module')

// The admin password update revokes every session for the user — including
// the one that authorized the request — so /auth/change-password must hand
// back a fresh session (or say reauth_required) instead of stranding the
// client with a dead token. These tests pin that contract.
//
// All externals are stubbed via Module._load (same pattern as the role
// middleware tests) so the router file can be required without node_modules.

const routes = []
const fakeRouter = () => {
  const r = {}
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    r[m] = (path, ...handlers) => routes.push({ method: m, path, handlers })
  }
  return r
}

// Mutable behavior knobs the tests flip per-case.
const state = {
  updateUserByIdError: null,
  signInResult: { data: { session: { access_token: 'new-at', refresh_token: 'new-rt', expires_at: 123 } }, error: null },
  staffUpdates: [],
}

const supabaseAdminStub = {
  auth: {
    admin: {
      updateUserById: async () => ({ error: state.updateUserByIdError }),
    },
  },
  from: (table) => ({
    update: (fields) => ({
      eq: async (col, val) => {
        state.staffUpdates.push({ table, fields, col, val })
        return { error: null }
      },
    }),
  }),
}

const origLoad = Module._load
Module._load = function (request) {
  if (request === 'express') return { Router: fakeRouter }
  if (request === 'express-rate-limit') return () => (req, res, next) => next()
  if (request === '../services/supabase') return { supabaseAdmin: supabaseAdminStub }
  if (request === '../middleware/auth') return (req, res, next) => next()
  if (request === '../services/visibleTools') return { getVisibleTools: async () => [] }
  if (request === '@supabase/supabase-js') {
    return { createClient: () => ({ auth: { signInWithPassword: async () => state.signInResult } }) }
  }
  return origLoad.apply(this, arguments)
}
test.after(() => { Module._load = origLoad })

require('./auth')
const changePassword = routes.find(r => r.method === 'post' && r.path === '/change-password')
const handler = changePassword.handlers[changePassword.handlers.length - 1]

function run(body, staff = { id: 'staff-1', email: 'user@wcstrength.com' }) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      cookies: [],
      status(c) { this.statusCode = c; return this },
      cookie(name, value, opts) { this.cookies.push({ name, value, opts }); return this },
      json(payload) { resolve({ status: this.statusCode, payload, cookies: this.cookies }) },
    }
    handler({ body, staff }, res)
  })
}

test('successful change returns a fresh session and refreshes the SSO cookie', async () => {
  state.staffUpdates.length = 0
  const { status, payload, cookies } = await run({ new_password: 'longenough' })
  assert.strictEqual(status, 200)
  assert.strictEqual(payload.token, 'new-at')
  assert.strictEqual(payload.refresh_token, 'new-rt')
  assert.strictEqual(payload.expires_at, 123)
  assert.strictEqual(cookies[0]?.name, 'wcs_session')
  assert.strictEqual(cookies[0]?.value, 'new-at')
  // must_change_password cleared on the staff row
  assert.deepStrictEqual(state.staffUpdates[0]?.fields, { must_change_password: false })
})

test('re-login failure still succeeds but flags reauth_required (no dead token kept)', async () => {
  state.signInResult = { data: null, error: { message: 'nope' } }
  const { status, payload } = await run({ new_password: 'longenough' })
  state.signInResult = { data: { session: { access_token: 'new-at', refresh_token: 'new-rt', expires_at: 123 } }, error: null }
  assert.strictEqual(status, 200)
  assert.strictEqual(payload.token, undefined)
  assert.strictEqual(payload.reauth_required, true)
})

test('short password is rejected with 400', async () => {
  const { status } = await run({ new_password: 'short' })
  assert.strictEqual(status, 400)
})

test('failed Supabase password update returns 500', async () => {
  state.updateUserByIdError = { message: 'boom' }
  const { status } = await run({ new_password: 'longenough' })
  state.updateUserByIdError = null
  assert.strictEqual(status, 500)
})
