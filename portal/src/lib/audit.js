// Fire-and-forget audit event helper.
// The /audit-log endpoint returns 202 immediately and inserts in the
// background, but we also do not await on this side — never block the UI
// for a logging side-effect.

import { api, getToken } from './api'

const HOSTNAME = (() => {
  try {
    if (typeof window !== 'undefined' && window.wcsElectron?.version) {
      // Best-effort kiosk identifier. The launcher tab title is set per-tab
      // and persists through navigation, so we tack on the launcher version
      // (same across kiosks but useful for filtering by client build).
      return 'launcher'
    }
  } catch {}
  return null
})()

export function logEvent(eventType, options = {}) {
  if (!getToken()) return
  const body = JSON.stringify({
    event_type: eventType,
    target: options.target || null,
    metadata: options.metadata || null,
    hostname: options.hostname || HOSTNAME,
  })
  // Don't await. Swallow errors silently so logging is invisible to UX.
  api('/audit-log', { method: 'POST', body }).catch(() => {})
}
