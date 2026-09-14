import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Every component a file renders must exist in that file.
//
// THIS SHIPPED, AND IT WHITE-SCREENED THE REVENUE REPORT. Refactoring
// RevenueReport deleted `ComparisonCard` along with the dead chart above it,
// while two call sites kept rendering it. `vite build` passed — a bundler
// resolves an unknown capitalised identifier to a runtime global lookup, so an
// undefined component is a build-time non-event and a render-time
// ReferenceError. The report loaded and then vanished.
//
// This is the check the bundler will not do: for each file, collect the
// capitalised JSX tags it renders and assert each name appears as a declaration
// or an import somewhere in the same file.
//
// DELIBERATELY SHALLOW. It does not resolve imports or understand scope. It
// asks "does this name appear as a declaration anywhere in this file", which is
// the question that catches a deletion.
//
// THE DECLARATION SEARCH RUNS ON RAW SOURCE, on purpose. A first version
// stripped strings so their contents could not look like code, and that was
// worse than useless: an apostrophe in ordinary JSX text ("Don't") opens a
// string that swallows everything to the next one, hiding real declarations. It
// reported two components that were defined perfectly well further down the
// file. Comments are stripped for TAG detection only, where the risk runs the
// other way.
//
// Function declarations hoist, so a component defined below its call site is
// correct and must not be flagged. Namespaced tags (<Foo.Bar />) check the root.
// ---------------------------------------------------------------------------

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Capitalised tags that are not components declared in userland.
const BUILTIN = new Set(['Fragment', 'Suspense', 'StrictMode', 'Profiler'])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

/** Comments removed, so a <Tag> written inside one is not treated as rendered. */
function withoutComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

function declarationPattern(name) {
  return new RegExp(
    [
      `(?:function|const|let|var|class)\\s+${name}\\b`, // declared in this file
      `import\\s+${name}\\b`,                          // default import
      `\\bas\\s+${name}\\b`,                           // aliased import
      `\\b${name}\\s*(?:,|\\})`,                       // named import / destructured
      `\\b${name}\\s*[:=]`,                            // assigned, or renamed in a pattern
    ].join('|'),
    'm'
  )
}

function undefinedComponents(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const rendered = new Set(
    [...withoutComments(raw).matchAll(/<\s*([A-Z][\w]*)(?:\.[\w.]+)?[\s/>]/g)].map(m => m[1])
  )
  return [...rendered].filter(
    name => !BUILTIN.has(name) && !declarationPattern(name).test(raw)
  )
}

test('no file renders a component it does not have', () => {
  const offenders = []
  for (const file of walk(SRC)) {
    for (const name of undefinedComponents(file)) {
      offenders.push(
        `${path.relative(SRC, file).split(path.sep).join('/')} renders <${name}> ` +
        'but never defines or imports it'
      )
    }
  }
  assert.deepEqual(offenders, [],
    'An undefined component builds fine and throws a ReferenceError on render, ' +
    'which white-screens the page.\n  ' + offenders.join('\n  '))
})

// The detector has to detect, or deleting its regex leaves a test that guards
// nothing. This is the exact shape that shipped.
test('the detector finds a deleted component', () => {
  const broken = [
    "import { useState } from 'react'",
    'function Kept() { return <div /> }',
    'export default function Thing() {',
    '  return <div><Kept /><Gone label="x" /></div>',
    '}',
  ].join('\n')
  const tmp = path.join(SRC, '__jsxdefined_fixture__.jsx')
  fs.writeFileSync(tmp, broken)
  try {
    assert.deepEqual(undefinedComponents(tmp), ['Gone'])
  } finally {
    fs.unlinkSync(tmp)
  }
})

// A component declared BELOW its call site is correct — function declarations
// hoist. Flagging that would have made this test unshippable.
test('the detector accepts a component defined further down the file', () => {
  const fine = [
    'export default function Thing() {',
    '  return <div><SummaryCard label="x" /></div>',
    '}',
    'function SummaryCard({ label }) { return <span>{label}</span> }',
  ].join('\n')
  const tmp = path.join(SRC, '__jsxdefined_hoist_fixture__.jsx')
  fs.writeFileSync(tmp, fine)
  try {
    assert.deepEqual(undefinedComponents(tmp), [])
  } finally {
    fs.unlinkSync(tmp)
  }
})

// An apostrophe in JSX text must not hide the declarations after it. This is
// the false positive that the first version of this test produced.
test('an apostrophe in JSX text does not blind the detector', () => {
  const fine = [
    'export default function Thing() {',
    "  return <div>Don't worry<Card /></div>",
    '}',
    'function Card() { return <span /> }',
  ].join('\n')
  const tmp = path.join(SRC, '__jsxdefined_apostrophe_fixture__.jsx')
  fs.writeFileSync(tmp, fine)
  try {
    assert.deepEqual(undefinedComponents(tmp), [])
  } finally {
    fs.unlinkSync(tmp)
  }
})

test('the detector accepts imports, aliases and destructuring', () => {
  const fine = [
    "import Default from './Default'",
    "import { Named, Other as Aliased } from './mod'",
    'const Local = () => <div />',
    'export default function Thing() {',
    '  return <div><Default /><Named /><Aliased /><Local /></div>',
    '}',
  ].join('\n')
  const tmp = path.join(SRC, '__jsxdefined_ok_fixture__.jsx')
  fs.writeFileSync(tmp, fine)
  try {
    assert.deepEqual(undefinedComponents(tmp), [])
  } finally {
    fs.unlinkSync(tmp)
  }
})
