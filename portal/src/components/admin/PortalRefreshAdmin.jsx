import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

// Bumps app_config.portal_force_refresh_at so every open portal tab
// reloads on its next 60s poll. Used after shipping a hotfix or bad
// data that needs everyone on the new state immediately.

export default function PortalRefreshAdmin() {
  const [current, setCurrent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pushing, setPushing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    api('/config/portal-version')
      .then(res => setCurrent(res?.refresh_at || null))
      .catch(err => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function handlePush() {
    if (!confirm('Force every open portal tab to reload within ~60 seconds. Continue?')) return
    setError('')
    setMessage('')
    setPushing(true)
    try {
      const res = await api('/config/portal-force-refresh', { method: 'POST' })
      setCurrent(res?.refresh_at || null)
      setMessage(`Pushed at ${new Date(res?.refresh_at).toLocaleTimeString()}. All tabs reload on their next 60s poll.`)
    } catch (err) {
      setError(err.message || 'Push failed')
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="bg-surface border border-border rounded-xl p-5">
        <p className="text-sm text-text-primary mb-1 font-semibold">Force-reload every open portal tab</p>
        <p className="text-xs text-text-muted leading-relaxed">
          Every tab polls <code>/config/portal-version</code> on a 60-second tick. When this timestamp changes, the tab hard-reloads, pulling the latest Vite bundles and Supabase data. Use after pushing a hotfix or after a data fix where stale browser caches would mislead staff.
        </p>
        <p className="text-xs text-text-muted leading-relaxed mt-2">
          Does NOT log users out — sessions and auth tokens are preserved. Only the page is reloaded.
        </p>
      </div>

      {loading ? (
        <p className="loading-card mx-auto block my-6">Loading...</p>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-muted mb-1">Last refresh broadcast</p>
            <p className="text-2xl font-bold text-text-primary">
              {current
                ? new Date(current).toLocaleString()
                : <span className="text-text-muted text-base font-normal">Never</span>}
            </p>
          </div>

          <button
            type="button"
            onClick={handlePush}
            disabled={pushing}
            className="w-full px-4 py-3 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 disabled:opacity-40"
          >
            {pushing ? 'Pushing...' : 'Force Refresh All Users'}
          </button>

          {message && <p className="text-sm text-green-700">{message}</p>}
          {error && <p className="text-sm text-wcs-red">{error}</p>}
        </div>
      )}
    </div>
  )
}
