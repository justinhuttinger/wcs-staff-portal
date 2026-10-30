// memos.js imports ../services/supabase, which calls createClient at module load.
// Nothing here talks to a real database; these only inspect the route table.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'

const test = require('node:test')
const assert = require('node:assert')
const router = require('./memos')

function routeEntry(path, method) {
  return router.stack.find(l => l.route && l.route.path === path && l.route.methods[method])
}

test('every memo route is registered', () => {
  for (const [path, method] of [
    ['/live', 'get'],
    ['/manage', 'get'],
    ['/editions', 'post'],
    ['/editions/:id', 'put'],
    ['/editions/:id/clubs/:slug', 'put'],
    ['/editions/:id/clubs/:slug/publish', 'post'],
    ['/editions/:id/clubs/:slug/end', 'post'],
  ]) {
    assert.ok(routeEntry(path, method), `expected ${method.toUpperCase()} ${path}`)
  }
})

test('company routes require a company editor and club routes load the club context', () => {
  const guard = (path, method) => routeEntry(path, method).route.stack[0].name
  assert.strictEqual(guard('/editions', 'post'), 'requireCompanyEditor')
  assert.strictEqual(guard('/editions/:id', 'put'), 'requireCompanyEditor')
  assert.strictEqual(guard('/editions/:id/clubs/:slug', 'put'), 'loadClubContext')
  assert.strictEqual(guard('/editions/:id/clubs/:slug/publish', 'post'), 'loadClubContext')
  assert.strictEqual(guard('/editions/:id/clubs/:slug/end', 'post'), 'loadClubContext')
})

test('the whole router sits behind sign-in and the memos tile', () => {
  const gates = router.stack.filter(l => !l.route)
  assert.ok(gates.length >= 2, 'expected authenticate and requireTile on the router')
})
