import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveHydration } from './uiPrefsResolve.js'

const LOCAL = { theme: 'classic', accent: 'signal_red', density: 'comfortable', layout: 'spotlight', pinned: [] }

test('a saved server row wins over everything', () => {
  const remote = { theme: 'press', accent: 'lime', density: 'compact', layout: 'rows', pinned: ['tool:drive'] }
  const r = resolveHydration({ remote, orgDefault: { theme: 'spotlight' }, local: LOCAL })
  assert.equal(r.action, 'apply')
  assert.equal(r.prefs.theme, 'press')
  assert.deepEqual(r.prefs.pinned, ['tool:drive'])
})

test('no server row and an org default: adopt the org default', () => {
  const r = resolveHydration({ remote: {}, orgDefault: { theme: 'spotlight', accent: 'ember' }, local: LOCAL })
  assert.equal(r.action, 'adopt')
  assert.equal(r.prefs.theme, 'spotlight')
  assert.equal(r.prefs.accent, 'ember')
  // Unset org keys fall through to what this browser already had.
  assert.equal(r.prefs.density, 'comfortable')
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
