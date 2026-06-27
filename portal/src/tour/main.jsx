import React from 'react'
import ReactDOM from 'react-dom/client'
import TourCheckinApp from './TourCheckinApp'
import '../index.css'

// Standalone, login-free entry. Token comes from the query string so this is a
// plain physical file (/tour.html?token=...) the static host always serves -
// no SPA path-rewrite needed.
const token = new URLSearchParams(window.location.search).get('token') || ''

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TourCheckinApp token={token} />
  </React.StrictMode>
)
