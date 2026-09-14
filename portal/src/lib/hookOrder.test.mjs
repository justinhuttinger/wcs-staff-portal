import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// A hook must not sit below a loading guard.
//
// THIS IS A REAL BUG THAT SHIPPED. The Day One report grew a
// `useState(pendingFor)` beside the table that used it, which put it below the
// component's `if (loading) return` / `if (!data) return` guards. The first
// render called four hooks; the render after the data arrived called five.
// React treats a changed hook count as a corrupt component and unmounts the
// tree, so the report went white the instant it finished loading -- the worst
// possible shape of failure, because "it loaded fine and then vanished" reads
// as a data problem rather than a code one.
//
// There is no eslint in this project, so react-hooks/rules-of-hooks is not
// there to catch it. This is the cheap substitute: it looks for exactly the
// shape that broke, and nothing cleverer, so it does not cry wolf.
//
// SCOPED DELIBERATELY. It matches a hook at component-body indentation (two
// spaces) after a guard clause at the same indentation whose condition mentions
// loading / error / missing data. Hooks inside nested callbacks are indented
// further and are not hits; a guard inside a nested callback is likewise
// ignored. Run over the whole of src it finds one thing, which is the point --
// a check that reports ninety maybes is a check nobody runs twice.
// ---------------------------------------------------------------------------

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const HOOK = /^ {2}(const \[?[\w{},: ]+\]?\s*=\s*)?(useState|useEffect|useMemo|useCallback|useRef|useReducer|useLayoutEffect|useCancellableFetch)\s*\(/
const GUARD = /^ {2}if\s*\(.*\b(loading|error|!\s*data|!\s*rows|!\s*report)\b.*\)\s*return\b/
const COMPONENT = /^(export default )?function [A-Z]/

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

function findConditionalHooks(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const found = []
  let inComponent = false
  let guardLine = -1
  lines.forEach((line, i) => {
    if (COMPONENT.test(line)) { inComponent = true; guardLine = -1 }
    if (!inComponent) return
    if (GUARD.test(line)) guardLine = i + 1
    if (guardLine > 0 && HOOK.test(line)) {
      found.push({ hookLine: i + 1, guardLine, text: line.trim() })
      guardLine = -1
    }
  })
  return found
}

test('no component calls a hook below its loading guard', () => {
  const offenders = []
  for (const file of walk(SRC)) {
    for (const hit of findConditionalHooks(file)) {
      offenders.push(
        `${path.relative(SRC, file).split(path.sep).join('/')}:${hit.hookLine} ` +
        `- hook below the guard on line ${hit.guardLine}: ${hit.text}`
      )
    }
  }
  assert.deepEqual(offenders, [],
    'A hook after an early return changes the hook count between renders and ' +
    'white-screens the component. Move it up with the other hooks.\n  ' +
    offenders.join('\n  '))
})

// The detector has to actually detect. Without this, deleting the regex body
// would leave a test that passes forever and guards nothing.
test('the detector finds the bug it was written for', () => {
  const broken = [
    'export default function Thing() {',
    '  const [a, setA] = useState(null)',
    '  const { data, loading } = useCancellableFetch(fn, [])',
    '  if (loading) return null',
    '  const [b, setB] = useState(null)',
    '  return <div>{a}{b}{data}</div>',
    '}',
  ].join('\n')
  const tmp = path.join(SRC, '__hookorder_fixture__.jsx')
  fs.writeFileSync(tmp, broken)
  try {
    const hits = findConditionalHooks(tmp)
    assert.equal(hits.length, 1)
    assert.equal(hits[0].hookLine, 5)
    assert.equal(hits[0].guardLine, 4)
  } finally {
    fs.unlinkSync(tmp)
  }
})

// And it must not fire on the ordinary shape: a guard, then plain code, with
// every hook above it. Otherwise the fix for one report is a red test for
// thirty others.
test('the detector leaves correct components alone', () => {
  const fine = [
    'export default function Thing() {',
    '  const [a, setA] = useState(null)',
    '  const rows = useMemo(() => {',
    '    if (!a) return []',
    '    return [a]',
    '  }, [a])',
    '  if (!rows) return null',
    '  const total = rows.length',
    '  return <div>{total}</div>',
    '}',
  ].join('\n')
  const tmp = path.join(SRC, '__hookorder_ok_fixture__.jsx')
  fs.writeFileSync(tmp, fine)
  try {
    assert.deepEqual(findConditionalHooks(tmp), [])
  } finally {
    fs.unlinkSync(tmp)
  }
})
