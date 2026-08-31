import { test } from 'node:test'
import assert from 'node:assert/strict'
import { THEME_OPTIONS, LAYOUT_OPTIONS, DENSITY_OPTIONS } from './themeOptions.js'
import { THEMES, LAYOUTS, DENSITIES } from '../../lib/theme.js'

test('every theme in the engine has a swatch, and vice versa', () => {
  assert.deepEqual(THEME_OPTIONS.map(o => o.key).sort(), [...THEMES].sort())
})

test('every layout and density in the engine has a label', () => {
  assert.deepEqual(LAYOUT_OPTIONS.map(o => o.key).sort(), [...LAYOUTS].sort())
  assert.deepEqual(DENSITY_OPTIONS.map(o => o.key).sort(), [...DENSITIES].sort())
})

test('every swatch carries the fields the preview reads', () => {
  for (const o of THEME_OPTIONS) {
    for (const f of ['bg', 'surface', 'ink', 'radius', 'font']) {
      assert.ok(o.swatch[f], `${o.key} swatch is missing ${f}`)
    }
    assert.ok('red' in o.swatch, `${o.key} swatch is missing red (use null to mean "use the accent")`)
  }
})
