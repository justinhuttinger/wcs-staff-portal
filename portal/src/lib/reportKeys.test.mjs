import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// A report key must not collide with a group key.
//
// THIS SHIPPED. A Training report was added with the key `training`, and
// REPORT_GROUPS already had a group keyed `training` (the PT reports). The hash
// router resolves a group before a report, so clicking the Training tile opened
// the PT group and landed on PT Health. The report was unreachable and the
// failure looked like a mis-wired tile rather than a name clash.
//
// Parsed out of the source rather than imported because ReportingView is a JSX
// module with a deep import graph; the two lists are plain literals and reading
// them is both cheaper and immune to whatever the component happens to pull in.
// ---------------------------------------------------------------------------

const VIEW = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../components/ReportingView.jsx'
)

function parse() {
  const src = fs.readFileSync(VIEW, 'utf8')

  const tilesBlock = src.slice(
    src.indexOf('const ALL_REPORT_TILES = ['),
    src.indexOf('\n]', src.indexOf('const ALL_REPORT_TILES = ['))
  )
  const groupsBlock = src.slice(
    src.indexOf('const REPORT_GROUPS = ['),
    src.indexOf('\n]', src.indexOf('const REPORT_GROUPS = ['))
  )

  const reportKeys = [...tilesBlock.matchAll(/\{\s*key:\s*'([^']+)'/g)].map(m => m[1])
  const groupKeys = [...groupsBlock.matchAll(/^\s{4}key:\s*'([^']+)'/gm)].map(m => m[1])
  return { reportKeys, groupKeys, groupsBlock }
}

test('the two key lists were actually found', () => {
  const { reportKeys, groupKeys } = parse()
  // Guards the parser itself: if ReportingView is restructured and these come
  // back empty, every assertion below would pass while checking nothing.
  assert.ok(reportKeys.length > 10, `only found ${reportKeys.length} report keys`)
  assert.ok(groupKeys.length >= 2, `only found ${groupKeys.length} group keys`)
})

test('no report key collides with a group key', () => {
  const { reportKeys, groupKeys } = parse()
  const clashes = reportKeys.filter(k => groupKeys.includes(k))
  assert.deepEqual(clashes, [],
    'The hash router resolves a group before a report, so a report sharing a ' +
    'group key is unreachable — it opens the group instead. Rename one.')
})

test('report keys are unique', () => {
  const { reportKeys } = parse()
  const seen = new Set()
  const dupes = reportKeys.filter(k => (seen.has(k) ? true : (seen.add(k), false)))
  assert.deepEqual(dupes, [])
})

// Every key a group lists has to be a real report, or the group renders a tile
// that leads nowhere.
test('every report a group lists exists', () => {
  const { reportKeys, groupsBlock } = parse()
  const listed = [...groupsBlock.matchAll(/reports:\s*\[([^\]]*)\]/g)]
    .flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]))
  const missing = [...new Set(listed.filter(k => !reportKeys.includes(k)))]
  assert.deepEqual(missing, [])
})
