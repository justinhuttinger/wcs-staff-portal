// Portal appearance switch (Classic ↔ WP-style ↔ Spotlight).
//
// The whole mechanism is attributes on <html>. index.css defines a
// [data-theme="wp"] and a [data-theme="spotlight"] block that redefine the
// design tokens, so every semantic utility (bg-surface, text-primary, …)
// re-resolves without touching a single component.
//   data-theme    classic | wp | spotlight   which palette
//   data-accent   signal_red | …             the one user-selectable color
//   data-density  comfortable | compact      panel height + padding
//   data-layout   spotlight | grid | rows    how the home board renders
// Accent/density/layout only mean anything under the spotlight theme; they are
// still written unconditionally so switching themes back and forth is lossless.
//
// Persistence is localStorage (per-device, per-person). No backend. index.html
// has a tiny inline copy of the read+apply step so nobody flashes Classic
// before this module loads — keep the storage keys in sync with that script.

export const THEME_KEY = 'wcs-portal-theme'
export const ACCENT_KEY = 'wcs-portal-accent'
export const DENSITY_KEY = 'wcs-portal-density'
export const LAYOUT_KEY = 'wcs-portal-layout'

export const THEMES = ['classic', 'wp', 'spotlight']
export const LAYOUTS = ['spotlight', 'grid', 'rows']
export const DENSITIES = ['comfortable', 'compact']

// Enumerated accents. `ink` is the text color that sits on top of the accent,
// picked once for contrast against the accent (WCAG ratio in `contrast`) rather
// than computed on every render. Adding one here means adding a matching
// [data-accent='…'] block in index.css.
export const ACCENTS = [
  { key: 'signal_red', hex: '#ff2e2e', ink: '#0b0b0d', contrast: 5.7, label: 'Signal Red' },
  { key: 'deep_red', hex: '#c8102e', ink: '#ffffff', contrast: 5.9, label: 'Deep Red' },
  { key: 'ember', hex: '#ff5b1f', ink: '#0b0b0d', contrast: 6.8, label: 'Ember' },
  { key: 'steel', hex: '#4fc3d9', ink: '#0b0b0d', contrast: 10.1, label: 'Steel' },
  { key: 'lime', hex: '#a3e635', ink: '#0b0b0d', contrast: 13.4, label: 'Lime' },
]

export const DEFAULTS = {
  theme: 'classic',
  accent: 'signal_red',
  density: 'comfortable',
  layout: 'spotlight',
}

/** Event fired on <window> whenever prefs change, so live views can re-render. */
export const THEME_EVENT = 'wcs-appearance-change'

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
    accent: read(ACCENT_KEY, ACCENTS.map(a => a.key), DEFAULTS.accent),
    density: read(DENSITY_KEY, DENSITIES, DEFAULTS.density),
    layout: read(LAYOUT_KEY, LAYOUTS, DEFAULTS.layout),
  }
}

/** Read the saved theme, defaulting to 'classic'. Never throws. */
export function getTheme() {
  return getPrefs().theme
}

/** Reflect prefs onto <html> without persisting them. */
export function applyPrefs(prefs) {
  const raw = { ...DEFAULTS, ...(prefs || {}) }
  // Normalize here so an unknown value (a retired accent, a hand-edited
  // localStorage key) falls back to the default rather than rendering unstyled.
  const p = {
    theme: THEMES.includes(raw.theme) ? raw.theme : DEFAULTS.theme,
    accent: ACCENTS.some(a => a.key === raw.accent) ? raw.accent : DEFAULTS.accent,
    density: DENSITIES.includes(raw.density) ? raw.density : DEFAULTS.density,
    layout: LAYOUTS.includes(raw.layout) ? raw.layout : DEFAULTS.layout,
  }
  const el = document.documentElement
  if (p.theme === 'classic') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', p.theme)
  el.setAttribute('data-accent', p.accent)
  el.setAttribute('data-density', p.density)
  el.setAttribute('data-layout', p.layout)
  return p
}

/** Reflect a theme onto <html> without persisting it (keeps other prefs). */
export function applyTheme(theme) {
  return applyPrefs({ ...getPrefs(), theme }).theme
}

/**
 * Persist + apply a partial prefs patch. Unknown values fall back to the
 * current value, so a removed accent option degrades to the default instead of
 * breaking the user. Returns the full resolved prefs actually applied.
 */
export function setPrefs(patch) {
  const next = { ...getPrefs(), ...(patch || {}) }
  const resolved = applyPrefs(next)
  try {
    localStorage.setItem(THEME_KEY, resolved.theme)
    localStorage.setItem(ACCENT_KEY, resolved.accent)
    localStorage.setItem(DENSITY_KEY, resolved.density)
    localStorage.setItem(LAYOUT_KEY, resolved.layout)
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
