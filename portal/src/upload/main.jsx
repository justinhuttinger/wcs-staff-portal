import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import UploadApp from './UploadApp'

// Standalone, login-free page: /upload.html?t=<token>. The token names one
// person on one task and can only fill that person's own slots.
const token = new URLSearchParams(window.location.search).get('t') || ''

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UploadApp token={token} />
  </React.StrictMode>
)
