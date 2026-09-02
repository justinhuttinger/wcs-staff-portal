// facilitySchedule.js imports ../services/supabase, which calls createClient at
// module load. Satisfy it so the route module can be required at all; nothing
// here talks to a real database -- these tests only inspect the router's own
// route table and pure helpers, the same way jobs.test.js stubs supabase for
// blogAutomation.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'

const test = require('node:test')
const assert = require('node:assert')
const router = require('./facilitySchedule')

function routeEntry(path, method) {
  return router.stack.find(l => l.route && l.route.path === path && l.route.methods[method])
}

// CRITICAL 1 regression: the preview route was missing its :date segment
// entirely (`/series/:id/edit-preview`), so req.params.date was always
// undefined and the shared handler 400'd on every single preview call --
// dead on arrival for the whole "all from here on" feature. Nothing short of
// inspecting the actual route table catches a missing URL segment; a unit
// test of the date-format check alone would have passed either way.
test('edit-preview and from are both anchored on a :date segment, symmetrically', () => {
  const preview = routeEntry('/series/:id/edit-preview/:date', 'post')
  const apply = routeEntry('/series/:id/from/:date', 'put')
  assert.ok(preview, 'expected POST /series/:id/edit-preview/:date to be registered')
  assert.ok(apply, 'expected PUT /series/:id/from/:date to be registered')
})

test('no dateless edit-preview route survives as a stale duplicate', () => {
  assert.strictEqual(routeEntry('/series/:id/edit-preview', 'post'), undefined)
})

test('the full route table has no other bare-:id series mutation routes hiding a similar gap', () => {
  const seriesRoutes = router.stack
    .filter(l => l.route && l.route.path.startsWith('/series/:id'))
    .map(l => l.route.path)
  // Both the cancel-from-here delete and the two edit routes carry the
  // anchor they act from either in the query string (delete's ?through=) or
  // the path (:date) -- listed here so a future route that drops its anchor
  // fails this test instead of shipping silently broken like edit-preview did.
  assert.deepStrictEqual(new Set(seriesRoutes), new Set([
    '/series/:id',
    '/series/:id/edit-preview/:date',
    '/series/:id/from/:date',
  ]))
})
