import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { applyPrefs, getPrefs } from '../lib/theme'
import { loadClubs } from '../config/locations'

// Same reason as desktop main.jsx: the pre-paint script in mobile.html sets
// --portal-accent from localStorage but not its derived ink, so without this
// the ink stays at the CSS default for the whole session whenever the API is
// unreachable at boot. applyPrefs, not setPrefs, so it never writes to storage
// or fires THEME_EVENT and cannot race hydrateUiPrefs's later pull.
applyPrefs(getPrefs())

// The club list has to be loaded before the app is imported: many components
// build their club lists at import time (see config/locations.js).
loadClubs().then(async () => {
  const { default: MobileApp } = await import('./MobileApp')
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <MobileApp />
    </React.StrictMode>
  )
})
