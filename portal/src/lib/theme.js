// Portal appearance switch (Classic ↔ Press).
//
// The whole mechanism is a single attribute on <html>. index.css defines a
// [data-theme="press"] block that redefines the design tokens, so every
// semantic utility (bg-surface, text-primary, …) re-resolves without
// touching a single component.
//   data-theme    classic | press   which palette
// Press additionally swaps the whole shell for a persistent top nav (see
// PortalNav.jsx) — it is the one theme that changes structure, not just tokens.
//
// WP-style and Spotlight themes, and the accent/density/layout settings that
// went with them, were removed: those three settings only ever did anything
// under Spotlight, and Spotlight itself is gone, so there was nothing left
// for them to control. Do not reintroduce ACCENTS, DENSITIES, LAYOUTS or their
// storage keys without a theme that actually reads them. Anyone who had `wp`
// or `spotlight` saved falls back to classic via the normalizer in
// `applyPrefs` below; that fallback is the whole migration story, so keep it.
//
// Persistence: localStorage is the pre-paint MIRROR, not the source of truth.
// The server row (user_ui_preferences.prefs) is authoritative and is synced by
// lib/uiPrefs.js. index.html has a tiny inline copy of the read+apply step so
// nobody flashes Classic before this module loads — keep the storage keys in
// sync with that script.

export const THEME_KEY = 'wcs-portal-theme'

export const THEMES = ['classic', 'press']

export const DEFAULTS = {
  theme: 'classic',
}

/** Event fired on <window> whenever prefs change, so live views can re-render. */
export const THEME_EVENT = 'wcs-appearance-change'

export const BACKGROUND_KEY = 'wcs-portal-background'
export const BACKGROUND_DIM_KEY = 'wcs-portal-background-dim'

// 'location' keeps the club photo the portal has always shown; 'none' is a
// flat ground; 'gallery' and 'upload' both carry a storage path in `value`.
export const BACKGROUND_KINDS = ['location', 'gallery', 'upload', 'none']
export const DEFAULT_BACKGROUND = { kind: 'location', value: '' }
// 60 is not arbitrary: it is the black/60 scrim App.jsx used to hardcode, so
// everyone who never touches this sees exactly what they saw before.
export const DEFAULT_BACKGROUND_DIM = 60

const MAX_BACKGROUND_VALUE = 200

/** Coerce anything into a usable { kind, value }. Never throws. */
export function normalizeBackground(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_BACKGROUND }
  if (!BACKGROUND_KINDS.includes(raw.kind)) return { ...DEFAULT_BACKGROUND }
  const value = typeof raw.value === 'string' ? raw.value : ''
  if (value.length > MAX_BACKGROUND_VALUE) return { ...DEFAULT_BACKGROUND }
  // gallery and upload are meaningless without a path; location and none are
  // meaningless with one.
  if ((raw.kind === 'gallery' || raw.kind === 'upload') && !value) return { ...DEFAULT_BACKGROUND }
  if (raw.kind === 'location' || raw.kind === 'none') return { kind: raw.kind, value: '' }
  return { kind: raw.kind, value }
}

/** Coerce anything into an integer percentage in 0-80. Never throws. */
export function normalizeDim(raw) {
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN)
  if (!Number.isFinite(n)) return DEFAULT_BACKGROUND_DIM
  return Math.min(80, Math.max(0, Math.round(n)))
}

/** Read the saved background pair. Never throws. */
export function getBackgroundPrefs() {
  let background = DEFAULT_BACKGROUND
  let backgroundDim = DEFAULT_BACKGROUND_DIM
  try {
    background = normalizeBackground(JSON.parse(localStorage.getItem(BACKGROUND_KEY) || 'null'))
  } catch {}
  try {
    backgroundDim = normalizeDim(localStorage.getItem(BACKGROUND_DIM_KEY))
  } catch {}
  return { background, backgroundDim }
}

/**
 * Persist + apply a partial background patch. Fires THEME_EVENT so the sync
 * layer in uiPrefs.js pushes it up, exactly as it does for the theme.
 */
export function setBackgroundPrefs(patch) {
  const cur = getBackgroundPrefs()
  const next = {
    background: normalizeBackground(patch?.background !== undefined ? patch.background : cur.background),
    backgroundDim: normalizeDim(patch?.backgroundDim !== undefined ? patch.backgroundDim : cur.backgroundDim),
  }
  try {
    localStorage.setItem(BACKGROUND_KEY, JSON.stringify(next.background))
    localStorage.setItem(BACKGROUND_DIM_KEY, String(next.backgroundDim))
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }))
  } catch {}
  return next
}

function read(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

/** Read every saved appearance pref. Never throws. */
export function getPrefs() {
  return {
    theme: read(THEME_KEY, THEMES, DEFAULTS.theme),
  }
}

/** Read the saved theme, defaulting to 'classic'. Never throws. */
export function getTheme() {
  return getPrefs().theme
}

/** Reflect prefs onto <html> without persisting them. */
export function applyPrefs(prefs) {
  const raw = { ...DEFAULTS, ...(prefs || {}) }
  // Normalize here so an unknown value (a retired theme like wp or spotlight,
  // a hand-edited localStorage key) falls back to the default rather than
  // rendering unstyled. This is the whole migration story for anyone who had
  // a removed theme saved.
  const p = {
    theme: THEMES.includes(raw.theme) ? raw.theme : DEFAULTS.theme,
  }
  // node --test has no `document`; guard so the normalization above stays
  // testable without a DOM.
  const el = typeof document === 'undefined' ? null : document.documentElement
  if (el) {
    if (p.theme === 'classic') el.removeAttribute('data-theme')
    else el.setAttribute('data-theme', p.theme)
  }
  return p
}

/** Reflect a theme onto <html> without persisting it (keeps other prefs). */
export function applyTheme(theme) {
  return applyPrefs({ ...getPrefs(), theme }).theme
}

/**
 * Persist + apply a partial prefs patch. An unknown theme falls back to the
 * default instead of breaking the user. Returns the full resolved prefs
 * actually applied.
 */
export function setPrefs(patch) {
  const next = { ...getPrefs(), ...(patch || {}) }
  const resolved = applyPrefs(next)
  try {
    localStorage.setItem(THEME_KEY, resolved.theme)
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: resolved }))
  } catch {}
  return resolved
}

/** Persist + apply a theme. Returns the normalized value actually set. */
export function setTheme(theme) {
  return setPrefs({ theme }).theme
}
