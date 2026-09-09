// A person's starred Analytics reports — their own shortlist, pinned to the
// top of the Analytics sidebar above the category groups.
//
// Storage mirrors lib/pinnedTabs.js exactly, and for the same reason: this is
// a localStorage mirror that lib/uiPrefs.js syncs to `user_ui_preferences`, so
// a shortlist follows a person from the front desk machine to their laptop and
// survives an API outage mid-shift.
//
// A favorite is stored as a plain ANALYTICS_REPORTS key ('club-snapshot').
// Nothing here checks the key against the registry: a retired report is
// filtered out at render (reportByKey returns undefined), and validating here
// would mean importing the registry into a storage module and giving the
// browser mirror a second copy of the catalogue to fall out of step with.

export const FAVORITES_KEY = 'wcs-analytics-favorites'

/** Fired on <window> when favorites change, so every star re-renders live. */
export const FAVORITES_EVENT = 'wcs-analytics-favorites-change'

// The whole prefs blob is capped at 4KB server-side and shares that budget
// with the theme and the pinned bar. Twenty keys is far more than a shortlist
// anyone reads and nowhere near the cap.
export const MAX_FAVORITES = 20

// Registry keys are lowercase slugs. Anything else was not written by this app.
const KEY_RE = /^[a-z0-9-]+$/

function clean(keys) {
  return [...new Set((keys || []).filter(k => typeof k === 'string' && KEY_RE.test(k)))]
    .slice(0, MAX_FAVORITES)
}

/** Read the saved favorites. Never throws; always an array. */
export function getFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return clean(raw)
  } catch {
    return []
  }
}

/** Persist favorites and notify listeners. Returns what was actually stored. */
export function setFavorites(keys) {
  const next = clean(keys)
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(FAVORITES_EVENT, { detail: next }))
  } catch {}
  return next
}

/**
 * Star or unstar one report. Adding past MAX_FAVORITES is a no-op rather than
 * a silent eviction — dropping a report someone already starred to make room
 * is the more surprising of the two behaviours (same call as pinnedTabs).
 *
 * New favorites append, so the list stays in the order they were starred.
 */
export function toggleFavorite(key) {
  const cur = getFavorites()
  if (cur.includes(key)) return setFavorites(cur.filter(k => k !== key))
  if (cur.length >= MAX_FAVORITES) return cur
  return setFavorites([...cur, key])
}

export function isFavorite(key) {
  return getFavorites().includes(key)
}
