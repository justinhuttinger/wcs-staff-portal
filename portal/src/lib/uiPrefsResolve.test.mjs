import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveHydration } from './uiPrefsResolve.js'
import { normalizeAccent } from './theme.js'

const LOCAL = {
  theme: 'classic',
  accent: '#e53e3e',
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

test('retired density/layout org-default keys are ignored', () => {
  // appearance_default_density and _layout may still sit in app_config from
  // before those settings were removed. They must not reappear in prefs.
  const r = resolveHydration({
    remote: {},
    orgDefault: { theme: 'press', accent: '#1d4ed8', density: 'compact', layout: 'rows' },
    local: LOCAL,
  })
  assert.equal(r.prefs.theme, 'press')
  assert.equal(r.prefs.accent, '#1d4ed8')
  assert.equal(r.prefs.density, undefined)
  assert.equal(r.prefs.layout, undefined)
})

test('accent IS seeded from the org default, like theme (not like pinned/background)', () => {
  const r = resolveHydration({ remote: {}, orgDefault: { theme: 'classic', accent: '#0f766e' }, local: LOCAL })
  assert.equal(r.action, 'adopt')
  assert.equal(r.prefs.accent, '#0f766e')
})

test('no org-default accent: adopt what this browser had', () => {
  const r = resolveHydration({ remote: {}, orgDefault: { theme: 'classic' }, local: LOCAL })
  assert.equal(r.prefs.accent, LOCAL.accent)
})

test('a stale non-hex org-default accent (left over from a retired accent feature) is harmless', () => {
  // appearance_default_accent may already hold a NAME like 'signal_red' from
  // before this feature existed. resolveHydration passes it through
  // unchanged (like it does for a retired theme value); normalizeAccent is
  // what actually guards against it once setPrefs applies the value.
  const r = resolveHydration({ remote: {}, orgDefault: { theme: 'classic', accent: 'signal_red' }, local: LOCAL })
  assert.equal(r.prefs.accent, 'signal_red')
  assert.equal(normalizeAccent(r.prefs.accent), normalizeAccent(undefined))
})
