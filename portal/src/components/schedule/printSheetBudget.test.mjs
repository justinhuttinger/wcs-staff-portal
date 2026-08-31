import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// These read the source as TEXT, which is unusual, so: they guard two things a
// normal test cannot see and that both shipped broken once.
//
//  1. CSS cascade order. The time-grid rules started life as `.ps-week--grid`,
//     one class, which LOSES to `.ps--landscape .ps-week` above it. The
//     seven-column template kept winning, eight children went into a
//     seven-column grid, Sunday wrapped to a second row and the sheet ran onto
//     a second page. Nothing failed -- it built, rendered, and printed wrong.
//  2. Two numbers in two files that must agree. The day-name row height is
//     stated in the CSS and the body height in the JSX, and the hour rail is
//     only aligned while they match.
//
// A rendering test would be better. Until there is one, these stop the exact
// regression that already happened.

const here = dirname(fileURLToPath(import.meta.url))
const styles = readFileSync(join(here, 'PrintScheduleStyles.jsx'), 'utf8')
const sheet = readFileSync(join(here, 'PrintScheduleSheet.jsx'), 'utf8')

test('the time-grid rules come after the landscape rules they override', () => {
  const landscape = styles.indexOf('.ps--landscape .ps-week {')
  const grid = styles.indexOf('.ps--landscape .ps-week--grid {')
  assert.ok(landscape > 0, 'landscape .ps-week rule not found')
  assert.ok(grid > 0, 'grid .ps-week--grid rule not found')
  assert.ok(grid > landscape, 'the grid block must sit BELOW the landscape block or it loses the cascade')
})

test('every time-grid selector is scoped to landscape', () => {
  // A bare `.ps-week--grid` or `.ps-block` is the bug: one class cannot beat
  // the two-class landscape rules.
  const offenders = styles
    .split('\n')
    .filter(l => /^\s*\.(ps-week--grid|ps-block|ps-hourline|ps-rail)/.test(l))
  assert.deepEqual(offenders, [], `unscoped time-grid selectors: ${offenders.join(' | ')}`)
})

test('the body height fits a landscape page with the header and day-name row', () => {
  const m = sheet.match(/const GRID_HEIGHT_IN = ([\d.]+)/)
  assert.ok(m, 'GRID_HEIGHT_IN not found')
  const bodyIn = Number(m[1])

  const PAGE_IN = 8.5          // landscape short edge
  const MARGINS_IN = 0.8       // .4in top + .4in bottom, per the @page rule
  const HEADER_IN = 0.85       // measured: .62 logo + .07 pad + .04 rule + .12 margin
  const DAY_NAME_IN = 0.24     // stated in the CSS, asserted below

  const used = HEADER_IN + DAY_NAME_IN + bodyIn
  assert.ok(
    used <= PAGE_IN - MARGINS_IN,
    `sheet needs ${used}in but only ${PAGE_IN - MARGINS_IN}in prints on one page`,
  )
})

test('the day-name row and the rail spacer are the same stated height', () => {
  // They are set by one rule listing both selectors. If that is ever split,
  // the two heights can drift and every hour label slides by the difference.
  assert.match(
    styles,
    /\.ps--landscape \.ps-week--grid \.ps-day__name,\s*\n\s*\.ps--landscape \.ps-week--grid \.ps-rail__spacer \{\s*\n\s*height: \.24in;/,
    'the day-name row and rail spacer must share one height declaration',
  )
})
