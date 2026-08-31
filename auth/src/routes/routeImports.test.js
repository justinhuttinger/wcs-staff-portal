const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// Every route file must import the middleware it uses.
//
// This exists because a missing import took the whole auth API down on
// 2026-08-31. A rebase resolved `const { requireRole } = ...` into
// `const { roleLevel } = ...`, and `requireRole('admin')` a hundred lines below
// became a ReferenceError. Middleware is called at MODULE level -- it is an
// argument to router.get() -- so the failure is not a 500 on one endpoint, it
// is the process refusing to boot. Every route in the portal went with it.
//
// Nothing caught it. `node --check` parses, it does not resolve names. The test
// suite never requires the route files, because they build a Supabase client at
// import time. So the first thing to evaluate the file was production.
//
// Requiring the modules for real would be the better test and is what this
// stands in for: that needs stubbed env plus a WebSocket the local Node 20 does
// not have. Reading the source is what can run everywhere today.

const ROUTES_DIR = __dirname

// Names that arrive by import and are invoked while the module is being
// evaluated. A dropped import of any of these is a boot failure rather than a
// runtime error, which is what makes them worth a test of their own.
const MIDDLEWARE = [
  'requireRole', 'requireReportAccess', 'requireTile', 'requireMarketing',
  'requireMarketingCapability', 'authenticate', 'roleLevel', 'canSeeAllLocations',
]

// Comments go before anything is matched. websiteSubmissions.js carries the
// line "check here instead of using requireRole()" -- a note saying it
// deliberately does NOT call it, which a naive scan reads as a call and fails
// the guard on a perfectly healthy tree. A test that cries wolf on master gets
// deleted, so this matters more than it looks.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function sourceFiles() {
  return fs.readdirSync(ROUTES_DIR)
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map(f => [f, stripComments(fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8'))])
}

// Everything the file binds at the top level: destructured or default requires,
// plus its own declarations. Deliberately loose -- a false PASS is only a
// missed guard, while a false FAIL would block an unrelated PR.
function boundNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim()
      if (name) names.add(name)
    }
  }
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(/g)) names.add(m[1])
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=/g)) names.add(m[1])
  for (const m of src.matchAll(/function\s+(\w+)\s*\(/g)) names.add(m[1])
  return names
}

test('every route file imports the middleware it calls', () => {
  const missing = []
  for (const [file, src] of sourceFiles()) {
    const bound = boundNames(src)
    for (const name of MIDDLEWARE) {
      if (new RegExp(`\\b${name}\\s*\\(`).test(src) && !bound.has(name)) {
        missing.push(`${file}: uses ${name}() but never imports it`)
      }
    }
  }
  assert.deepStrictEqual(missing, [], missing.join('\n'))
})

test('the guard actually catches a dropped import', () => {
  // A test that cannot fail guards nothing, and the real one passes on a
  // healthy tree by definition. This is the proof that detection works, using
  // the exact shape that took production down.
  const broken = [
    "const { roleLevel } = require('../middleware/role')",
    "router.get('/x', requireRole('admin'), handler)",
  ].join('\n')
  const bound = boundNames(broken)
  assert.ok(bound.has('roleLevel'))
  assert.ok(!bound.has('requireRole'), 'requireRole must read as unbound here')

  const healthy = "const { roleLevel, requireRole } = require('../middleware/role')"
  assert.ok(boundNames(healthy).has('requireRole'))
})

test('a mention in a comment is not a call', () => {
  assert.ok(!stripComments('// we do not use requireRole() here\nconst a = 1').includes('requireRole'))
  assert.ok(!stripComments('/* requireRole() */\nconst a = 1').includes('requireRole'))
  // A URL must survive: the `[^:]` guard is what stops "https://" being read
  // as the start of a line comment and eating the rest of the line.
  assert.ok(stripComments("const u = 'https://x.test/a'").includes('https://x.test/a'))
})
