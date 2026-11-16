import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import ShareApp from './ShareApp'

// Standalone, login-free page: /share.html?t=<token>. Shows what was submitted
// on one task; the owner can turn the link off at any time.
const token = new URLSearchParams(window.location.search).get('t') || ''

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ShareApp token={token} />
  </React.StrictMode>
)
