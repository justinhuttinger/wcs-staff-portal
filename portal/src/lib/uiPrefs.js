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

import { getPrefs, setPrefs, THEME_EVENT } from './theme'
import { getPinned, setPinned, PINNED_EVENT } from './pinnedTabs'
import { getUiPreferences, saveUiPreferences } from './api'

// While applying the server's copy we must not turn round and push it back:
// setPrefs/setPinned both fire the events this module listens to.
let applyingFromServer = false
let pushTimer = null
let started = false

/** The full local snapshot, in the shape the server stores. */
function snapshot() {
  const p = getPrefs()
  return { theme: p.theme, accent: p.accent, density: p.density, layout: p.layout, pinned: getPinned() }
}

/**
 * Pull this user's prefs and apply them locally. Call once after login.
 *
 * An empty server row means this person has never saved — their current local
 * prefs are then pushed up, so an existing user's setup is adopted rather than
 * wiped the first time they load a build with this in it.
 */
export async function hydrateUiPrefs() {
  let remote
  try {
    const res = await getUiPreferences()
    remote = res?.prefs
  } catch {
    // Offline or API down: the mirror already painted, so there is nothing to
    // do and nothing to report.
    return
  }

  const hasRemote = remote && Object.keys(remote).length > 0
  if (!hasRemote) {
    // First time this person is seen. Adopt whatever is in this browser.
    try { await saveUiPreferences(snapshot()) } catch {}
    return
  }

  applyingFromServer = true
  try {
    // setPrefs and setPinned both normalize: an unknown theme or a retired pin
    // key falls back rather than rendering something broken.
    setPrefs({
      theme: remote.theme,
      accent: remote.accent,
      density: remote.density,
      layout: remote.layout,
    })
    setPinned(Array.isArray(remote.pinned) ? remote.pinned : [])
  } finally {
    applyingFromServer = false
  }
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
