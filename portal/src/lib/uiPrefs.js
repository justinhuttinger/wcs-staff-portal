// Keeps per-user UI preferences (appearance + pinned shortcuts) in step between
// the server and this browser's localStorage.
//
// The server is the source of truth, so the theme and the pinned bar follow a
// person from the front desk machine to their laptop. localStorage stays as a
// mirror for two reasons that are not going away:
//
//   1. index.html reads it BEFORE first paint to apply the theme. An API
//      round-trip cannot happen that early, so without the mirror everyone
//      would see a flash of Classic on every load.
//   2. If the API is unreachable mid-shift, nobody loses their bar.
//
// Consequence worth knowing: the very first load on a NEW machine paints
// Classic and switches once hydrate() returns. Only the first load, and only
// on a machine that person has never used.

import { getPrefs, setPrefs, THEME_EVENT, getBackgroundPrefs, setBackgroundPrefs } from './theme'
import { getPinned, setPinned, PINNED_EVENT } from './pinnedTabs'
import { getUiPreferences, saveUiPreferences, getAppSettings } from './api'
import { resolveHydration } from './uiPrefsResolve'

export { resolveHydration }

// While applying the server's copy we must not turn round and push it back:
// setPrefs/setPinned both fire the events this module listens to.
let applyingFromServer = false
let pushTimer = null
let started = false

/** The full local snapshot, in the shape the server stores. */
function snapshot() {
  const p = getPrefs()
  const b = getBackgroundPrefs()
  return {
    theme: p.theme,
    background: b.background, backgroundDim: b.backgroundDim,
    pinned: getPinned(),
  }
}

/**
 * Pull this user's prefs and apply them locally. Call once after login.
 *
 * A saved server row wins outright. Otherwise this person starts on the org's
 * appearance default (falling back to whatever this browser already had for
 * anything the org has not set), and that starting point is pushed up as
 * their first saved row so they can change it after.
 *
 * Returns the signed background image URL from the same GET, or null (never
 * saved to localStorage — it is short-lived and must live in memory only).
 */
export async function hydrateUiPrefs() {
  let remote
  let backgroundUrl = null
  let orgDefault = {}
  try {
    const [res, settings] = await Promise.all([
      getUiPreferences(),
      // A missing or unreadable org default is not an error: it just means
      // there is no house style and the browser's own prefs are adopted.
      getAppSettings('appearance_default_').catch(() => ({})),
    ])
    remote = res?.prefs
    backgroundUrl = res?.backgroundUrl || null
    // appearance_default_accent, _density and _layout may still sit in
    // app_config from before these settings were removed. Nothing reads them
    // once org default is built from theme alone; deleting the rows would
    // need a migration this change does not warrant, so they are left in place.
    orgDefault = {
      theme: settings?.appearance_default_theme,
    }
  } catch {
    // Offline or API down: the mirror already painted, so there is nothing to
    // do and nothing to report.
    return null
  }

  const { action, prefs } = resolveHydration({ remote, orgDefault, local: snapshot() })

  applyingFromServer = true
  try {
    // setPrefs and setPinned both normalize: an unknown theme or a retired pin
    // key falls back rather than rendering something broken.
    setPrefs({ theme: prefs.theme })
    setBackgroundPrefs({ background: prefs.background, backgroundDim: prefs.backgroundDim })
    setPinned(Array.isArray(prefs.pinned) ? prefs.pinned : [])
  } finally {
    applyingFromServer = false
  }

  // No saved row yet, whether adopting the org default or this browser's own
  // prefs: write it up as this person's first row.
  if (action === 'adopt') {
    try { await saveUiPreferences(snapshot()) } catch {}
  }

  return backgroundUrl
}

/**
 * Push the local snapshot up, debounced. Clicking through four accents in a
 * row should be one write, not four.
 */
function schedulePush() {
  if (applyingFromServer) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    // Fire and forget: a failed save leaves localStorage correct, and the next
    // change retries. Losing a preference is not worth interrupting anyone.
    saveUiPreferences(snapshot()).catch(() => {})
  }, 600)
}

/**
 * Start mirroring local changes up to the server. Idempotent, so remounting
 * the app does not stack listeners.
 */
export function startUiPrefsSync() {
  if (started) return
  started = true
  window.addEventListener(THEME_EVENT, schedulePush)
  window.addEventListener(PINNED_EVENT, schedulePush)
}
