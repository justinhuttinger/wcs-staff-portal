import React from 'react'
import ReactDOM from 'react-dom/client'
import TourCheckinApp from './TourCheckinApp'
import '../index.css'
import { startAutoUpdate } from './autoUpdate'

// Standalone, login-free entry. Token comes from the query string so this is a
// plain physical file (/tour.html?token=...) the static host always serves -
// no SPA path-rewrite needed.
const token = new URLSearchParams(window.location.search).get('token') || ''

// Register the service worker that handles Web Push notifications. On iOS the
// app must be added to the Home Screen (apple-mobile-web-app-capable, set in
// tour.html, keeps the token URL as the start URL and runs it standalone).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

// The iPad on the front desk is never closed, so nothing here would ever
// re-fetch the page and a deploy would stay invisible until somebody thought to
// reload. Checks for a new entry bundle and reloads when the desk is quiet.
startAutoUpdate(import.meta.url)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TourCheckinApp token={token} />
  </React.StrictMode>
)
