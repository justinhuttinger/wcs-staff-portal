import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// A number in a table cell must not carry the card layout.
//
// THIS SHIPPED, AND IT LOOKED LIKE A STYLING ACCIDENT. Drillable hardcoded
// `w-full text-left` on its button because it was written to wrap stat CARDS.
// When the same component started wrapping figures inside table cells, every
// drillable number in Membership and Day One was pushed hard to the left of its
// column while the plain ones stayed centred, so a row of figures read as
// misaligned rather than as clickable.
//
// Appending `w-auto` from the call site did not fix it: Tailwind resolves a
// conflict by the order rules appear in the stylesheet, not by the order
// classes appear on the element. Layout had to stop being hardcoded and become
// the caller's to state.
//
// THIS IS A SOURCE CHECK, NOT A RENDER. Rendering these would mean resolving
// Drillable's whole import graph — RecordsModal, the api client, the chart
// palette — which needs module mocking this project does not have and which is
// not worth standing up for an alignment fix. It asserts the two things that
// actually regressed: that Drillable takes its layout from a prop, and that the
// table-cell caller passes an inline one. It cannot confirm what the pixels do.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DRILLABLE = path.resolve(HERE, '../components/analytics/Drillable.jsx')
const DRILL_NUMBER = path.resolve(HERE, '../components/reports/DrillNumber.jsx')

const read = f => fs.readFileSync(f, 'utf8')

/** The template literal Drillable builds its button className from. */
function buttonClassExpression(src) {
  const m = /className=\{`([^`]*)`\}/.exec(src)
  assert.ok(m, 'could not find the button className in Drillable')
  return m[1]
}

test('Drillable takes its layout from a prop, not a hardcoded class', () => {
  const src = read(DRILLABLE)
  assert.match(src, /layout\s*=\s*'w-full text-left'/,
    'Drillable should default layout to the card layout, as a prop')

  const cls = buttonClassExpression(src)
  assert.ok(cls.includes('${layout}'), `the button must use the layout prop: ${cls}`)
  assert.ok(!/\bw-full\b/.test(cls),
    `w-full must not be hardcoded — a table cell cannot override it: ${cls}`)
  assert.ok(!/\btext-left\b/.test(cls),
    `text-left must not be hardcoded — it fights the column: ${cls}`)
})

test('the table-cell caller passes an inline layout', () => {
  const src = read(DRILL_NUMBER)
  const m = /layout="([^"]*)"/.exec(src)
  assert.ok(m, 'DrillNumber must pass an explicit layout')
  assert.ok(m[1].includes('inline'), `expected an inline layout, got: ${m[1]}`)
  assert.ok(!/\bw-full\b/.test(m[1]) && !/\btext-left\b/.test(m[1]),
    `the cell's own text-center has to win: ${m[1]}`)
})

// The card callers must keep what they were written for. If the default ever
// flips to inline, every stat card in Club Health silently shrinks to its text.
test('the default layout is still the card layout', () => {
  const src = read(DRILLABLE)
  const m = /layout\s*=\s*'([^']*)'/.exec(src)
  assert.ok(m, 'no default layout found')
  assert.ok(m[1].includes('w-full'), `cards need the full width: ${m[1]}`)
  assert.ok(m[1].includes('text-left'), `cards are not centred text: ${m[1]}`)
})

// Nothing clickable by accident — the rule that keeps a zero from opening an
// empty list, stated in code so a refactor cannot quietly drop it.
test('DrillNumber refuses to wrap a zero or a viewer without access', () => {
  const src = read(DRILL_NUMBER)
  assert.match(src, /const n = Number\(value\) \|\| 0/)
  assert.match(src, /if \(!enabled \|\| !set \|\| n === 0\)/,
    'a zero, a missing set, or no access must all render plain')
})
