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
// WP-style and Spotlight themes, and the density/layout settings that went
// with them, were removed: those settings only ever did anything under
// Spotlight, and Spotlight itself is gone, so there was nothing left for them
// to control. Do not reintroduce DENSITIES, LAYOUTS or their storage keys
// without a theme that actually reads them. Anyone who had `wp` or
// `spotlight` saved falls back to classic via the normalizer in `applyPrefs`
// below; that fallback is the whole migration story, so keep it.
//
// A separate accent color DID survive that cleanup and is reintroduced here:
// a per-user hex color for Classic tile icons and the tile hover state. It is
// stored as `--portal-accent` (and its derived `--portal-accent-ink`), a
// custom property distinct from `--color-wcs-red`. That red drives buttons,
// spinners, badges and the loading wheel across the whole portal; rebinding
// it to a user's accent choice would recolor all of those the moment someone
// picked navy. Only Classic tile styles read `--portal-accent`.
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

export const ACCENT_KEY = 'wcs-portal-accent'

// The red the portal has always used. Anyone who never opens the setting sees
// exactly what they saw before.
export const DEFAULT_ACCENT = '#e53e3e'

// Known-good starting points. The custom field accepts anything, so these are
// a convenience, not a guarantee: readability is enforced by accentInk below,
// which is what actually protects a bad custom choice.
export const ACCENT_PRESETS = [
  { hex: '#e53e3e', label: 'WCS Red' },
  { hex: '#c8102e', label: 'Deep Red' },
  { hex: '#ea580c', label: 'Ember' },
  { hex: '#1d4ed8', label: 'Blue' },
  { hex: '#0f766e', label: 'Teal' },
  { hex: '#4d7c0f', label: 'Olive' },
  { hex: '#6d28d9', label: 'Violet' },
  { hex: '#1a1a2e', label: 'Navy' },
]

/** Coerce anything into a #rrggbb string. Never throws. */
export function normalizeAccent(raw) {
  if (typeof raw !== 'string') return DEFAULT_ACCENT
  const s = raw.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  // Expand #abc to #aabbcc so the rest of the system only ever sees one shape.
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map(c => c + c).join('')
  return DEFAULT_ACCENT
}

/**
 * The text and icon color that sits ON TOP of the accent when a tile is
 * hovered. Computed from relative luminance rather than fixed to white,
 * because the custom field lets someone pick a pale color where white text
 * would disappear.
 *
 * Uses the WCAG relative-luminance formula with sRGB gamma expansion to get
 * the accent's luminance, then prefers white unless white's contrast ratio
 * against the accent drops below 3:1 (see the fallback below for why 3:1 and
 * why white is the default rather than whichever ink scores higher).
 */
export function accentInk(hex) {
  const h = normalizeAccent(hex)
  const channel = (i) => {
    const v = parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
  // Prefer white, which is what the design calls for and what the rest of the
  // portal already pairs with the brand red. Fall back to near-black only when
  // white would genuinely be hard to read, which the free custom hex field
  // makes possible. 3:1 is the WCAG floor for large text and UI components,
  // and it is the right floor here: at 16px semibold on a solid fill, white
  // above that ratio reads cleanly, while below it (pale yellows, near-whites)
  // it starts to disappear.
  //
  // The same ink also paints the 12px uppercase description on hover, where
  // the default red's white-on-red ratio (4.13:1) clears AA for the label but
  // misses AA for text that small, and where that description previously sat
  // as grey-on-white. That is a real, if minor, readability regression on
  // hover for the default accent, traded for one consistent ink across the
  // whole tile rather than a second computed color for a secondary line.
  const contrastWithWhite = 1.05 / (L + 0.05)
  return contrastWithWhite >= 3 ? '#ffffff' : '#0b0b0d'
}

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
  let accent = DEFAULT_ACCENT
  try {
    accent = normalizeAccent(localStorage.getItem(ACCENT_KEY))
  } catch {}
  return {
    theme: read(THEME_KEY, THEMES, DEFAULTS.theme),
    accent,
  }
}

/** Read the saved theme, defaulting to 'classic'. Never throws. */
export function getTheme() {
  return getPrefs().theme
}

/** Reflect prefs onto <html> without persisting them. */
export function applyPrefs(prefs) {
  const raw = { ...DEFAULTS, accent: DEFAULT_ACCENT, ...(prefs || {}) }
  // Normalize here so an unknown value (a retired theme like wp or spotlight,
  // a hand-edited localStorage key, or an old appearance_default_accent row
  // left over from a retired accent feature and still holding a NAME like
  // 'signal_red' rather than a hex string) falls back to the default rather
  // than rendering unstyled. This is the whole migration story for anyone who
  // had a removed theme or a stale accent value saved.
  const p = {
    theme: THEMES.includes(raw.theme) ? raw.theme : DEFAULTS.theme,
    accent: normalizeAccent(raw.accent),
  }
  // node --test has no `document`; guard so the normalization above stays
  // testable without a DOM.
  const el = typeof document === 'undefined' ? null : document.documentElement
  if (el) {
    if (p.theme === 'classic') el.removeAttribute('data-theme')
    else el.setAttribute('data-theme', p.theme)
    // Separate from --color-wcs-red on purpose: see the header comment.
    el.style.setProperty('--portal-accent', p.accent)
    el.style.setProperty('--portal-accent-ink', accentInk(p.accent))
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
    localStorage.setItem(ACCENT_KEY, resolved.accent)
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

