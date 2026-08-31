// Split out of uiPrefs.js with no imports of its own so `node --test` can load it:
// uiPrefs.js imports ./theme, ./pinnedTabs and ./api, which only Vite can resolve.

/**
 * Decide what a person's prefs should be at login.
 *
 * Three cases, in order:
 *   1. They have a saved server row. It wins outright.
 *   2. They do not, and the org has a default. They start on the org's look,
 *      and it is written up as their first row so they can change it after.
 *   3. Neither. Adopt whatever this browser already had, which is what shipped
 *      before org defaults existed and keeps an existing user's setup.
 *
 * Pins are deliberately never seeded from the org default: a shortcut bar is
 * personal, and half of what is pinnable is role-gated anyway. A background
 * is just as personal, so it is never seeded from the org default either.
 *
 * The accent is treated like the theme, not like pinned/background: a house
 * color is a reasonable thing for an admin to set for new staff, so it IS
 * seeded from the org default when there is no saved row.
 *
 * Pure and import-free on purpose, so it is unit-testable without a DOM.
 */
export function resolveHydration({ remote, orgDefault, local }) {
  const hasRemote = remote && Object.keys(remote).length > 0
  if (hasRemote) return { action: 'apply', prefs: remote }

  const d = orgDefault || {}
  return {
    action: 'adopt',
    prefs: {
      theme: d.theme || local.theme,
      accent: d.accent || local.accent,
      background: local.background,
      backgroundDim: local.backgroundDim,
      pinned: local.pinned,
    },
  }
}
