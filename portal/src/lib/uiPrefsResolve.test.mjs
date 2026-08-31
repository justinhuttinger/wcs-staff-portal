import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveHydration } from './uiPrefsResolve.js'

const LOCAL = {
  theme: 'classic',
  background: { kind: 'location', value: '' }, backgroundDim: 60,
  pinned: [],
}

test('a saved server row wins over everything', () => {
  const remote = { theme: 'press', pinned: ['tool:drive'] }
  const r = resolveHydration({ remote, orgDefault: { theme: 'spotlight' }, local: LOCAL })
  assert.equal(r.action, 'apply')
  assert.equal(r.prefs.theme, 'press')
  assert.deepEqual(r.prefs.pinned, ['tool:drive'])
})

test('no server row and an org default: adopt the org default', () => {
  const r = resolveHydration({ remote: {}, orgDefault: { theme: 'spotlight' }, local: LOCAL })
  assert.equal(r.action, 'adopt')
  // resolveHydration passes the stored value through unchanged even though
  // 'spotlight' is a retired theme; setPrefs normalizes it downstream, so
  // a retired theme can never actually reach the DOM.
  assert.equal(r.prefs.theme, 'spotlight')
})

test('no server row and no org default: adopt what this browser had', () => {
  const r = resolveHydration({ remote: null, orgDefault: {}, local: LOCAL })
  assert.equal(r.action, 'adopt')
  assert.deepEqual(r.prefs, LOCAL)
})

test('an unreadable org default is simply absent', () => {
  const r = resolveHydration({ remote: undefined, orgDefault: null, local: LOCAL })
  assert.equal(r.action, 'adopt')
  assert.equal(r.prefs.theme, 'classic')
})

test('pins are never taken from the org default', () => {
  const r = resolveHydration({ remote: {}, orgDefault: { theme: 'wp', pinned: ['tool:hr'] }, local: LOCAL })
  assert.deepEqual(r.prefs.pinned, [])
})

test('background is carried from the server row', () => {
  const remote = { theme: 'classic', background: { kind: 'upload', value: 'abc/1.jpg' }, backgroundDim: 20 }
  const r = resolveHydration({ remote, orgDefault: {}, local: LOCAL })
  assert.equal(r.prefs.background.kind, 'upload')
  assert.equal(r.prefs.backgroundDim, 20)
})

test('background is never seeded from the org default', () => {
  const local = { ...LOCAL, background: { kind: 'location', value: '' }, backgroundDim: 60 }
  const orgDefault = { theme: 'wp', background: { kind: 'gallery', value: 'shared/x.jpg' }, backgroundDim: 10 }
  const r = resolveHydration({ remote: {}, orgDefault, local })
  assert.deepEqual(r.prefs.background, { kind: 'location', value: '' })
  assert.equal(r.prefs.backgroundDim, 60)
})

test('a retired org-default key is ignored', () => {
  // appearance_default_accent and friends may still sit in app_config from
  // before these settings were removed. They must not reappear in prefs.
  const r = resolveHydration({
    remote: {},
    orgDefault: { theme: 'press', accent: 'lime', density: 'compact', layout: 'rows' },
    local: LOCAL,
  })
  assert.equal(r.prefs.theme, 'press')
  assert.equal(r.prefs.accent, undefined)
  assert.equal(r.prefs.density, undefined)
  assert.equal(r.prefs.layout, undefined)
})
