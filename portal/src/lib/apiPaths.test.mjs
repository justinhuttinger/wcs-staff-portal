import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Every path the portal calls must resolve to a real route on the API.
//
// THIS SHIPPED. The Revenue report called `/revenue/analysis` and got a 404.
// The revenue REPORT router is mounted at `/reports/revenue`; `/revenue` is the
// webhook and upload router — a different thing entirely. Every other revenue
// call in api.js already used the right prefix; the new one did not, and
// nothing anywhere could tell.
//
// CHECKING THE PREFIX ALONE IS NOT ENOUGH, which is the mistake the first
// version of this test made: `/revenue` IS a mounted prefix, so
// `/revenue/analysis` sailed through a prefix check and the test passed on the
// exact bug it was written for. So this resolves each mount to its router file
// and matches the remaining path against that router's own route table.
//
// A wrong path is invisible to the bundler, invisible to the type system
// (there isn't one), and invisible until someone opens the report — but the
// mounts and the calls are both literals, so it is perfectly mechanical.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url))
const API_JS = path.join(HERE, 'api.js')
const AUTH_SRC = path.resolve(HERE, '../../../auth/src')
const INDEX_JS = path.join(AUTH_SRC, 'index.js')

/** [{ prefix, file }] for every router index.js mounts from ./routes. */
function mounts() {
  const src = fs.readFileSync(INDEX_JS, 'utf8')
  const out = []
  for (const m of src.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*require\('(\.\/[^']+)'\)/g)) {
    out.push({ prefix: m[1], file: path.join(AUTH_SRC, m[2] + '.js') })
  }
  return out.filter(x => fs.existsSync(x.file))
}

/** The route paths a router file declares, as matchers. */
function routesIn(file) {
  const src = fs.readFileSync(file, 'utf8')
  const paths = [...src.matchAll(/\brouter\.(?:get|post|put|patch|delete|use|all)\(\s*'([^']*)'/g)]
    .map(m => m[1])
    .filter(p => p.startsWith('/'))
  // A router.use('/x', sub) mounts a nested router; treat it as a prefix that
  // swallows anything beneath it rather than chasing the sub-router.
  const nested = [...src.matchAll(/\brouter\.use\(\s*'([^']+)'\s*,/g)].map(m => m[1])
  return { paths, nested }
}

function toRegex(routePath) {
  const body = routePath
    .split('/')
    .map(seg => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`^${body}$`)
}

/** Every absolute path api.js passes to api(). */
function calledPaths() {
  const src = fs.readFileSync(API_JS, 'utf8')
  const out = new Set()
  for (const m of src.matchAll(/\bapi\(\s*[`'"](\/[A-Za-z0-9._\-/]*)/g)) out.add(m[1])
  return [...out]
}

/** null when it resolves, otherwise why it does not. */
function resolveCall(called, mountList) {
  const sorted = [...mountList].sort((a, b) => b.prefix.length - a.prefix.length)
  const mount = sorted.find(
    m => called === m.prefix || called.startsWith(m.prefix.endsWith('/') ? m.prefix : m.prefix + '/')
  )
  if (!mount) return 'is not under any router mounted in auth/src/index.js'

  const rest = called.slice(mount.prefix.length) || '/'
  const { paths, nested } = routesIn(mount.file)

  if (nested.some(n => rest === n || rest.startsWith(n + '/'))) return null
  if (paths.some(p => toRegex(p).test(rest))) return null

  // A path built from an interpolated id ends at the literal prefix and keeps
  // its trailing slash -- api(`/ticketing/types/${id}`) is captured as
  // '/ticketing/types/'. A route with a param one segment deeper is the match.
  const stem = rest.endsWith('/') && rest !== '/' ? rest.slice(0, -1) : rest
  if (paths.some(p => p === stem || p.startsWith(stem === '/' ? '/' : stem + '/'))) return null

  return `resolves to ${mount.prefix} (${path.basename(mount.file)}) but that router has no ${rest}`
}

test('the parsers actually found something', () => {
  assert.ok(fs.existsSync(INDEX_JS), `auth/src/index.js not found at ${INDEX_JS}`)
  assert.ok(mounts().length > 20, `only found ${mounts().length} mounted routers`)
  assert.ok(calledPaths().length > 50, `only found ${calledPaths().length} api() calls`)
})

test('every api() path resolves to a real route', () => {
  const mountList = mounts()
  const broken = []
  for (const called of calledPaths()) {
    const why = resolveCall(called, mountList)
    if (why) broken.push(`${called} ${why}`)
  }
  assert.deepEqual(broken, [],
    'These calls will 404 at runtime:\n  ' + broken.join('\n  '))
})

// The check that matters: the first version of this test passed on this exact
// input, because /revenue is a real mount. It has to fail now.
test('a path under the wrong router is caught, not just an unknown prefix', () => {
  const mountList = mounts()
  const revenue = mountList.find(m => m.prefix === '/revenue')
  assert.ok(revenue, 'expected /revenue to be mounted — the premise of this test')

  assert.ok(
    resolveCall('/revenue/analysis', mountList),
    '/revenue/analysis should NOT resolve: /revenue is the webhook router'
  )
  assert.equal(
    resolveCall('/reports/revenue/analysis', mountList), null,
    '/reports/revenue/analysis should resolve'
  )
  assert.ok(resolveCall('/nope/at/all', mountList))
})
