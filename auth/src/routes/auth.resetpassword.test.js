const test = require('node:test')
const assert = require('node:assert')
const Module = require('module')

// /auth/reset-password/complete sets a password from nothing but the token in
// an emailed link, so the guards around it are the whole security of it:
// the token must be live, and the staff row must still be active.
//
// Externals stubbed via Module._load, same pattern as auth.changepassword.test.

const routes = []
const fakeRouter = () => {
  const r = {}
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    r[m] = (path, ...handlers) => routes.push({ method: m, path, handlers })
  }
  return r
}

const state = {
  getUser: { data: { user: { id: 'staff-1' } }, error: null },
  staffRow: { id: 'staff-1', is_active: true },
  updateUserByIdError: null,
  passwordSetFor: null,
  resetEmailArgs: null,
  staffUpdates: [],
}

const supabaseAdminStub = {
  auth: {
    getUser: async (token) => (token === 'good' ? state.getUser : { data: null, error: { message: 'bad jwt' } }),
    resetPasswordForEmail: async (email, opts) => { state.resetEmailArgs = { email, opts }; return { error: null } },
    admin: {
      updateUserById: async (id, fields) => {
        state.passwordSetFor = { id, fields }
        return { error: state.updateUserByIdError }
      },
    },
  },
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.staffRow }) }) }),
    update: (fields) => ({ eq: async (col, val) => { state.staffUpdates.push({ fields, col, val }); return { error: null } } }),
  }),
}

const origLoad = Module._load
Module._load = function (request) {
  if (request === 'express') return { Router: fakeRouter }
  if (request === 'express-rate-limit') return () => (req, res, next) => next()
  if (request === '../services/supabase') return { supabaseAdmin: supabaseAdminStub }
  if (request === '../middleware/auth') return (req, res, next) => next()
  if (request === '../services/visibleTools') return { getVisibleTools: async () => [] }
  if (request === '../services/auditLog') return { record: async () => {} }
  if (request === '@supabase/supabase-js') return { createClient: () => ({ auth: {} }) }
  return origLoad.apply(this, arguments)
}
test.after(() => { Module._load = origLoad })

require('./auth')
const complete = routes.find(r => r.method === 'post' && r.path === '/reset-password/complete')
const request = routes.find(r => r.method === 'post' && r.path === '/reset-password')

function run(route, body) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(payload) { resolve({ status: this.statusCode, body: payload }) },
    }
    route.handlers.at(-1)({ body, ip: '1.2.3.4' }, res)
  })
}

test('the reset email points back at the portal', async () => {
  await run(request, { email: 'someone@wcstrength.com' })
  assert.match(state.resetEmailArgs.opts.redirectTo, /^https?:\/\/.+\//)
})

test('a live token sets the password and clears must_change_password', async () => {
  state.passwordSetFor = null
  const r = await run(complete, { access_token: 'good', new_password: 'longenough1' })
  assert.equal(r.status, 200)
  assert.deepEqual(state.passwordSetFor, { id: 'staff-1', fields: { password: 'longenough1' } })
  assert.ok(state.staffUpdates.some(u => u.fields.must_change_password === false))
})

test('no session is handed back — the change kills every session', async () => {
  const r = await run(complete, { access_token: 'good', new_password: 'longenough1' })
  assert.equal(r.body.token, undefined)
  assert.equal(r.body.refresh_token, undefined)
})

test('an expired or forged token sets nothing', async () => {
  state.passwordSetFor = null
  const r = await run(complete, { access_token: 'stale', new_password: 'longenough1' })
  assert.equal(r.status, 400)
  assert.match(r.body.error, /expired/i)
  assert.equal(state.passwordSetFor, null)
})

test('a deactivated staff member cannot reset from an old email', async () => {
  state.staffRow = { id: 'staff-1', is_active: false }
  state.passwordSetFor = null
  const r = await run(complete, { access_token: 'good', new_password: 'longenough1' })
  assert.equal(r.status, 403)
  assert.equal(state.passwordSetFor, null)
  state.staffRow = { id: 'staff-1', is_active: true }
})

test('a missing token or short password is refused', async () => {
  state.passwordSetFor = null
  assert.equal((await run(complete, { new_password: 'longenough1' })).status, 400)
  assert.equal((await run(complete, { access_token: 'good', new_password: 'short' })).status, 400)
  assert.equal(state.passwordSetFor, null)
})
