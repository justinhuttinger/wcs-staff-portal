// The portal's "Apps" — external services that open in a new tab.
//
// This lives in one place because two things now need the same answer: the
// Apps board in ToolGrid, and the Press nav's pinned-tab picker. When they
// disagreed, a pinned app could point somewhere the board never would.

import allTools from '../config/tools.json'

// Which built-in tool IDs are Apps rather than in-portal Tools.
export const APP_IDS = ['grow', 'abc', 'wheniwork', 'paychex', 'gmail']

/**
 * ABC is not a plain link — it opens the in-portal kiosk shim, which needs the
 * club and the deep-link target passed through. Everything else is its URL.
 */
export function resolveAppUrl(tool, { abcUrl, location } = {}) {
  if (tool.id !== 'abc') return tool.url
  const params = new URLSearchParams()
  if (abcUrl) params.set('abc_url', abcUrl)
  if (location) params.set('location', location)
  const qs = params.toString()
  return '/kiosk.html' + (qs ? '?' + qs : '')
}

/**
 * The app list for one club, URLs already resolved.
 * Milwaukie is the exception on both counts: it schedules elsewhere, so
 * WhenIWork is dropped, and it runs Zoho rather than Gmail.
 */
export function appsForLocation({ location, abcUrl } = {}) {
  const isMilwaukie = (location || '').toLowerCase() === 'milwaukie'
  return allTools
    .filter(t => APP_IDS.includes(t.id))
    .filter(t => !(isMilwaukie && t.id === 'wheniwork'))
    .map(t => (isMilwaukie && t.id === 'gmail'
      ? { ...t, label: 'Zoho Mail', description: 'Email', icon: 'zohomail', url: 'https://www.zoho.com/mail/login.html' }
      : t))
    .map(t => ({ ...t, url: resolveAppUrl(t, { abcUrl, location }) }))
}
