import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { loadClubs } from '../config/locations'

// Standalone, login-free entry. Same shape as groupx.html: a physical file with
// the token in the query string, because the static host does not rewrite
// path routes like /childcare/<token>.
const token = new URLSearchParams(window.location.search).get('token') || ''

loadClubs().then(async () => {
  const { default: ChildcareApp } = await import('./ChildcareApp')
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ChildcareApp token={token} />
    </React.StrictMode>
  )
})
