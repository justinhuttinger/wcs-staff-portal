import { useState, useEffect, useCallback } from 'react'
import { getPrefs, setPrefs, THEME_EVENT } from './theme'

// ProfileView and AppearanceAdmin both render the same appearance controls
// and both must stay in step with <html>'s actual data-* attributes, not
// just whatever was true when the component mounted. Hydration after login,
// a change made in the other of the two components, or a future
// background-tab picker all fire THEME_EVENT — this hook re-reads getPrefs()
// whenever that happens so the highlighted card never lies about the theme
// the page is actually showing.

export function useAppearancePrefs() {
  const [prefs, setLocalPrefs] = useState(getPrefs)

  useEffect(() => {
    const onChange = () => setLocalPrefs(getPrefs())
    window.addEventListener(THEME_EVENT, onChange)
    return () => window.removeEventListener(THEME_EVENT, onChange)
  }, [])

  const patch = useCallback((p) => {
    // setPrefs() persists, applies to <html>, and dispatches THEME_EVENT
    // synchronously. That dispatch re-enters onChange above, which reads
    // getPrefs() again and calls setLocalPrefs with an equal-valued (but
    // new) object — one extra, harmless render, not a loop, because the
    // event handler only ever reads state and never calls setPrefs itself.
    // We still set state here directly (rather than relying solely on the
    // event) so the caller's own patch resolves in the same render pass
    // instead of waiting on the event round-trip.
    setLocalPrefs(setPrefs(p))
  }, [])

  return [prefs, patch]
}
