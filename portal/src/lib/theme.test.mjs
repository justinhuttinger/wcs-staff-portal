import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBackground, normalizeDim, DEFAULT_BACKGROUND, DEFAULT_BACKGROUND_DIM, THEMES, applyPrefs, normalizeAccent, accentInk, DEFAULT_ACCENT, ACCENT_PRESETS } from './theme.js'

test('a well-formed background passes through', () => {
  assert.deepEqual(normalizeBackground({ kind: 'gallery', value: 'shared/abc.jpg' }),
    { kind: 'gallery', value: 'shared/abc.jpg' })
  assert.deepEqual(normalizeBackground({ kind: 'none', value: '' }), { kind: 'none', value: '' })
})

test('an unknown kind falls back to the default', () => {
  assert.deepEqual(normalizeBackground({ kind: 'wallpaper', value: 'x' }), DEFAULT_BACKGROUND)
  assert.deepEqual(normalizeBackground({ kind: 42, value: 'x' }), DEFAULT_BACKGROUND)
})

test('junk falls back to the default', () => {
  assert.deepEqual(normalizeBackground(null), DEFAULT_BACKGROUND)
  assert.deepEqual(normalizeBackground(undefined), DEFAULT_BACKGROUND)
  assert.deepEqual(normalizeBackground('gallery'), DEFAULT_BACKGROUND)
  assert.deepEqual(normalizeBackground([]), DEFAULT_BACKGROUND)
})

test('a kind that needs a value but has none falls back', () => {
  assert.deepEqual(normalizeBackground({ kind: 'gallery' }), DEFAULT_BACKGROUND)
  assert.deepEqual(normalizeBackground({ kind: 'upload', value: '' }), DEFAULT_BACKGROUND)
  // location and none carry no value, so a missing one is fine.
  assert.deepEqual(normalizeBackground({ kind: 'location' }), { kind: 'location', value: '' })
  assert.deepEqual(normalizeBackground({ kind: 'none' }), { kind: 'none', value: '' })
})

test('an overlong value is refused rather than truncated', () => {
  // The whole prefs blob is capped at 4096 bytes server-side; a storage path
  // is well under 200 characters, so anything longer is not one.
  assert.deepEqual(normalizeBackground({ kind: 'upload', value: 'x'.repeat(300) }), DEFAULT_BACKGROUND)
})

test('dim clamps into 0-80 and rounds', () => {
  assert.equal(normalizeDim(0), 0)
  assert.equal(normalizeDim(80), 80)
  assert.equal(normalizeDim(45.6), 46)
  assert.equal(normalizeDim(-5), 0)
  assert.equal(normalizeDim(200), 80)
})

test('a non-numeric dim falls back to the default', () => {
  assert.equal(normalizeDim('abc'), DEFAULT_BACKGROUND_DIM)
  assert.equal(normalizeDim(null), DEFAULT_BACKGROUND_DIM)
  assert.equal(normalizeDim(undefined), DEFAULT_BACKGROUND_DIM)
  assert.equal(normalizeDim(NaN), DEFAULT_BACKGROUND_DIM)
  // A numeric string is a number someone stringified. Accept it.
  assert.equal(normalizeDim('30'), 30)
})

test('the default dim reproduces the old hardcoded scrim', () => {
  assert.equal(DEFAULT_BACKGROUND_DIM, 60)
})

test('only classic and press are offered', () => {
  assert.deepEqual([...THEMES].sort(), ['classic', 'press'])
})

test('a retired theme falls back to classic', () => {
  // Users who chose wp or spotlight before they were removed must land
  // somewhere sensible rather than rendering unstyled. This normalizer is
  // what replaces a data migration.
  assert.equal(applyPrefs({ theme: 'spotlight' }).theme, 'classic')
  assert.equal(applyPrefs({ theme: 'wp' }).theme, 'classic')
  assert.equal(applyPrefs({ theme: 'nonsense' }).theme, 'classic')
  assert.equal(applyPrefs({}).theme, 'classic')
  assert.equal(applyPrefs(null).theme, 'classic')
})

test('press survives', () => {
  assert.equal(applyPrefs({ theme: 'press' }).theme, 'press')
})

test('a valid hex passes through, normalized to lowercase 6-digit', () => {
  assert.equal(normalizeAccent('#1D4ED8'), '#1d4ed8')
  assert.equal(normalizeAccent('#abc'), '#aabbcc')   // 3-digit shorthand expands
})

test('junk falls back to the default', () => {
  for (const bad of ['red', 'rgb(1,2,3)', '#12', '#12345', '#1234567', 'e53e3e', '', null, undefined, 42, {}]) {
    assert.equal(normalizeAccent(bad), DEFAULT_ACCENT)
  }
})

test('a retired accent name (org-default row left behind by an old feature) falls back to the default', () => {
  // appearance_default_accent may already hold NAMES like 'signal_red' from a
  // retired accent feature. normalizeAccent must reject those, not special-case them.
  assert.equal(normalizeAccent('signal_red'), DEFAULT_ACCENT)
})

test('the default is the red the portal already uses', () => {
  assert.equal(DEFAULT_ACCENT, '#e53e3e')
})

test('ink is white on dark accents and near-black on light ones', () => {
  // This is what stops a pale custom color making white text unreadable.
  assert.equal(accentInk('#e53e3e'), '#ffffff')   // the default red
  assert.equal(accentInk('#0b0b0d'), '#ffffff')   // near black
  assert.equal(accentInk('#1d4ed8'), '#ffffff')   // deep blue
  assert.equal(accentInk('#fde047'), '#0b0b0d')   // pale yellow
  assert.equal(accentInk('#ffffff'), '#0b0b0d')   // white
  assert.equal(accentInk('#a3e635'), '#0b0b0d')   // lime
})

test('ink is computed from luminance, not from a lookup of known values', () => {
  // An arbitrary color the palette has never seen must still get sane ink.
  assert.equal(accentInk('#000080'), '#ffffff')
  assert.equal(accentInk('#fffacd'), '#0b0b0d')
})

test('every preset is a valid hex and survives normalization', () => {
  for (const p of ACCENT_PRESETS) {
    assert.equal(normalizeAccent(p.hex), p.hex, `${p.label} is not already normalized`)
    assert.ok(p.label, 'every preset needs a label')
  }
})
