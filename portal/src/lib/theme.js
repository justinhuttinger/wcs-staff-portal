// Portal theme switch (Classic ↔ WP-style).
//
// The whole mechanism is one attribute: data-theme on <html>. index.css defines
// a [data-theme="wp"] block that redefines the design tokens, so every semantic
// utility (bg-surface, text-primary, …) re-resolves to the westcoaststrength.com
// palette. Classic = no attribute = the :root defaults.
//
// Persistence is localStorage (per-device, per-person). No backend. index.html
// has a tiny inline copy of the read+apply step so WP users don't flash Classic
// before this module loads — keep the storage key in sync with that script.

export const THEME_KEY = 'wcs-portal-theme'
export const THEMES = ['classic', 'wp']

/** Read the saved theme, defaulting to 'classic'. Never throws. */
export function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'wp' ? 'wp' : 'classic'
  } catch {
    return 'classic'
  }
}

/** Reflect a theme onto <html> without persisting it. */
export function applyTheme(theme) {
  const t = theme === 'wp' ? 'wp' : 'classic'
  if (t === 'wp') document.documentElement.setAttribute('data-theme', 'wp')
  else document.documentElement.removeAttribute('data-theme')
  return t
}

/** Persist + apply a theme. Returns the normalized value actually set. */
export function setTheme(theme) {
  const t = theme === 'wp' ? 'wp' : 'classic'
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch {}
  return applyTheme(t)
}
