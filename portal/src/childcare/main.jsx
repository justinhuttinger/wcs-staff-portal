import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { loadClubs } from '../config/locations'

// Standalone, login-free entry. Same shape as groupx.html: a physical file with
// the token in the query string, because the static host does not rewrite
// path routes like /childcare/<token>. ?token= is the check-in form, ?view=
// the read-only room board.
const params = new URLSearchParams(window.location.search)
const viewToken = params.get('view')
const token = viewToken || params.get('token') || ''

loadClubs().then(async () => {
  const { default: ChildcareApp } = await import('./ChildcareApp')
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ChildcareApp token={token} viewOnly={Boolean(viewToken)} />
    </React.StrictMode>
  )
})
