import { useEffect } from 'react'
import { api } from './api'

// Polls /config/portal-version every 60s. The first poll captures the tab's
// baseline; later polls compare against it and trigger a hard reload if the
// admin has bumped the timestamp. Lag is bounded by POLL_MS plus the time
// taken by a single fetch — typically <70s end to end.
//
// We intentionally use setTimeout, not setInterval, so a slow API call can
// never queue up overlapping polls.

const POLL_MS = 60 * 1000

export function useForceRefresh() {
  useEffect(() => {
    let baseline = null
    let cancelled = false

    async function poll() {
      if (cancelled) return
      try {
        const res = await api('/config/portal-version')
        const value = res?.refresh_at || null
        if (baseline === null) {
          // First successful poll seeds the baseline — this tab is "current"
          // relative to whatever timestamp is in app_config right now.
          baseline = value
        } else if (value && value !== baseline) {
          // Admin pushed a new refresh — drop everything and reload.
          // Use the no-args form; passing `true` is deprecated and a no-op
          // in modern browsers.
          window.location.reload()
          return
        }
      } catch {
        // Network blip, auth glitch, whatever — just try again next tick.
      }
      if (!cancelled) setTimeout(poll, POLL_MS)
    }

    poll()
    return () => { cancelled = true }
  }, [])
}
