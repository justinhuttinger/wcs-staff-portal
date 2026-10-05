import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'

// Standalone, login-free entry for the front desk iPads. Same shape as
// groupx.html: a physical file with the token in the query string, because the
// static host does not rewrite path routes.
const token = new URLSearchParams(window.location.search).get('token') || ''

import('./HelpPublicApp').then(({ default: HelpPublicApp }) => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <HelpPublicApp token={token} />
    </React.StrictMode>
  )
})
