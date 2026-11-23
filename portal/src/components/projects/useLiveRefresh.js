import { useEffect, useRef } from 'react'

// Calls `refresh` every `ms` while this browser tab is visible, and right
// away when the tab becomes visible again or the window regains focus, so a
// screen shared on a call (or a teammate's own view) stays current. Paused
// while the tab is hidden. `enabled` false turns it off.
export default function useLiveRefresh(refresh, { ms = 20000, enabled = true } = {}) {
  const fn = useRef(refresh)
  fn.current = refresh
  useEffect(() => {
    if (!enabled) return
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const run = () => { if (visible()) fn.current() }
    const timer = setInterval(run, ms)
    const onVisible = () => { if (visible()) fn.current() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [ms, enabled])
}
