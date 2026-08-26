// Pinned tabs for the Press nav — the user's own shortcuts, sitting to the
// right of Other.
//
// Storage mirrors lib/theme.js exactly: localStorage, per browser, per person,
// no backend. Same trade-off, made for the same reason — it ships today and
// costs nothing. When appearance prefs move to the user_ui_preferences table
// this should move with them, and the key below is what to migrate.
//
// A pin is stored as a plain string key. Apps are prefixed 'app:' and Tools
// 'tool:' so the two namespaces can never collide, and so a stored pin still
// says what kind of thing it is without consulting the catalog.

export const PINNED_KEY = 'wcs-portal-pinned'

/** Fired on <window> when pins change, so the nav re-renders live. */
export const PINNED_EVENT = 'wcs-pinned-change'

// The bar has to stay usable at 1440 alongside five fixed tabs and the brand.
export const MAX_PINNED = 5

/** Read the saved pins. Never throws; always an array. */
export function getPinned() {
  try {
    const raw = JSON.parse(localStorage.getItem(PINNED_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    // Keep only well-formed, de-duplicated keys, and hold the cap even if an
    // older build (or a hand-edited value) wrote more.
    return [...new Set(raw.filter(k => typeof k === 'string' && /^(app|tool):/.test(k)))].slice(0, MAX_PINNED)
  } catch {
    return []
  }
}

/** Persist pins and notify listeners. Returns what was actually stored. */
export function setPinned(keys) {
  const next = [...new Set((keys || []).filter(k => typeof k === 'string' && /^(app|tool):/.test(k)))].slice(0, MAX_PINNED)
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(next))
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(PINNED_EVENT, { detail: next }))
  } catch {}
  return next
}

/**
 * Add or remove one pin. Adding past MAX_PINNED is a no-op rather than a
 * silent eviction — dropping someone's existing shortcut to make room for a
 * new one is the more surprising of the two behaviours.
 */
export function togglePin(key) {
  const cur = getPinned()
  if (cur.includes(key)) return setPinned(cur.filter(k => k !== key))
  if (cur.length >= MAX_PINNED) return cur
  return setPinned([...cur, key])
}

export function isPinned(key) {
  return getPinned().includes(key)
}
