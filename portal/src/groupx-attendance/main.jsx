import React from 'react'
import ReactDOM from 'react-dom/client'
import GroupXAttendanceApp from './GroupXAttendanceApp'
import '../index.css'

// Standalone, login-free entry. Same shape as tour.html: a physical file with
// the token in the query string, because the static host does not rewrite
// path routes like /groupx/<token>.
const token = new URLSearchParams(window.location.search).get('token') || ''

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GroupXAttendanceApp token={token} />
  </React.StrictMode>
)
