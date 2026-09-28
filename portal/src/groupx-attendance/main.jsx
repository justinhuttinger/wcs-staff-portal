import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { loadClubs } from '../config/locations'

// Standalone, login-free entry. Same shape as tour.html: a physical file with
// the token in the query string, because the static host does not rewrite
// path routes like /groupx/<token>.
const token = new URLSearchParams(window.location.search).get('token') || ''

// The club list has to be loaded before the app is imported: many components
// build their club lists at import time (see config/locations.js).
loadClubs().then(async () => {
  const { default: GroupXAttendanceApp } = await import('./GroupXAttendanceApp')
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <GroupXAttendanceApp token={token} />
    </React.StrictMode>
  )
})
