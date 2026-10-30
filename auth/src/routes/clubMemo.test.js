// clubMemo.js imports ../services/supabase, which calls createClient at module load.
// Nothing here talks to a real database; a request that fails the key check never
// reaches it.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'

const test = require('node:test')
const assert = require('node:assert')
const router = require('./clubMemo')

const route = router.stack.find(l => l.route && l.route.path === '/' && l.route.methods.get)

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test('the card route sits behind the launcher key', () => {
  assert.strictEqual(route.route.stack[0].name, 'requireLauncherKey')
})

test('a wrong key is refused and a right key passes', () => {
  process.env.LAUNCHER_KEY = 'right'
  const gate = route.route.stack[0].handle
  const refused = fakeRes()
  gate({ headers: { 'x-launcher-key': 'wrong' } }, refused, () => assert.fail('should not continue'))
  assert.strictEqual(refused.statusCode, 401)
  let passed = false
  gate({ headers: { 'x-launcher-key': 'right' } }, fakeRes(), () => { passed = true })
  assert.strictEqual(passed, true)
  delete process.env.LAUNCHER_KEY
})

test('an unknown club is refused before any data is read', async () => {
  const res = fakeRes()
  await route.route.stack[1].handle({ query: { club: 'nope' } }, res)
  assert.strictEqual(res.statusCode, 400)
})
