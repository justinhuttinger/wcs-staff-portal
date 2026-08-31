import { test } from 'node:test'
import assert from 'node:assert/strict'
import { THEME_OPTIONS } from './themeOptions.js'
import { THEMES } from '../../lib/theme.js'

test('every theme in the engine has a swatch, and vice versa', () => {
  assert.deepEqual(THEME_OPTIONS.map(o => o.key).sort(), [...THEMES].sort())
})

test('every swatch carries the fields the preview reads', () => {
  for (const o of THEME_OPTIONS) {
    for (const f of ['bg', 'surface', 'ink', 'red', 'radius', 'font']) {
      assert.ok(o.swatch[f], `${o.key} swatch is missing ${f}`)
    }
  }
})
