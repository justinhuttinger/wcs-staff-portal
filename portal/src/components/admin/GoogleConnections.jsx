import { useState, useEffect, useCallback } from 'react'
import { getGoogleBusinessStatus } from '../../lib/api'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const SCOPE_INFO = [
  { key: 'has_business_manage', label: 'Business Profile', desc: 'Map impressions, calls, directions, location list' },
  { key: 'has_analytics', label: 'Google Analytics', desc: 'Sessions, sources, top pages, key events' },
  { key: 'has_drive', label: 'Google Drive', desc: 'In-portal Drive folder browser' },
]

function ScopeRow({ label, desc, granted }) {
  return (
    <div className="flex items-center gap-3 py-2 border-t border-border first:border-t-0">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${granted ? 'bg-green-100' : 'bg-red-100'}`}>
        {granted ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-4 h-4 text-green-700">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-4 h-4 text-red-700">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary">{label}</p>
        <p className="text-xs text-text-muted">{desc}</p>
      </div>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${granted ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
        {granted ? 'Granted' : 'Missing'}
      </span>
    </div>
  )
}

export default function GoogleConnections() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchStatus = useCallback(() => {
    setLoading(true)
    setError('')
    getGoogleBusinessStatus()
      .then(setStatus)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  function handleReconnect() {
    window.open(API_URL + '/google-business/authorize', '_blank', 'width=560,height=720')
  }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-text-muted">
        Single Google account powers Marketing reports (GBP + GA4) and the Shared Drive browser.
        Click <strong>Reconnect Google</strong> to upgrade scopes when a new feature is added.
      </p>

      {loading ? (
        <p className="text-center text-text-muted text-sm py-8">Checking connection...</p>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      ) : (
        <>
          <div className="bg-surface border border-border rounded-xl p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <p className="text-sm font-semibold text-text-primary">Connection Status</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {status?.authorized ? 'Connected to Google' : 'Not connected'}
                  {status?.location_count > 0 && ` — ${status.location_count} GBP location${status.location_count === 1 ? '' : 's'} cached`}
                </p>
              </div>
              <button
                onClick={handleReconnect}
                className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-red-700 transition-colors shrink-0"
              >
                {status?.authorized ? 'Reconnect Google' : 'Connect Google'}
              </button>
            </div>

            <div>
              {SCOPE_INFO.map(s => (
                <ScopeRow
                  key={s.key}
                  label={s.label}
                  desc={s.desc}
                  granted={!!status?.[s.key]}
                />
              ))}
            </div>
          </div>

          <button
            onClick={fetchStatus}
            className="text-xs text-text-muted hover:text-text-primary"
          >
            ↻ Refresh status
          </button>

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-xs text-yellow-900">
            <p className="font-semibold mb-1">When to reconnect:</p>
            <ul className="list-disc ml-5 space-y-0.5">
              <li>After deploying a new feature that needs an additional Google scope (Drive, Calendar, etc.)</li>
              <li>If you see "insufficient permissions" or 403 errors in Marketing or Drive</li>
              <li>After the connected Google account's password is changed</li>
            </ul>
            <p className="mt-2">
              The reconnect window will ask you to approve the listed scopes. After approval, click <em>Refresh status</em> above.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
