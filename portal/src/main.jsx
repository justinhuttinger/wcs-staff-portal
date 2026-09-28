import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { applyPrefs, getPrefs } from './lib/theme'
import { loadClubs } from './config/locations'

// Apply local prefs (including the derived --portal-accent-ink) before the
// app renders, independent of hydrateUiPrefs's network round trip. The
// index.html pre-paint script sets --portal-accent from localStorage but not
// its ink, so without this the ink stays at the CSS default white for the
// whole session whenever the API is unreachable at boot. This calls
// applyPrefs directly (not setPrefs), so it never touches localStorage or
// fires THEME_EVENT, meaning it cannot race or double-push against
// hydrateUiPrefs's later, authoritative setPrefs call.
applyPrefs(getPrefs())

// The club list has to be loaded before the app is imported: many components
// build their club lists at import time (see config/locations.js).
loadClubs().then(async () => {
  const { default: App } = await import('./App')
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
