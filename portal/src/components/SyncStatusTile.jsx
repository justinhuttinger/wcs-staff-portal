import { useState, useEffect } from 'react'
import { getSyncStatus } from '../lib/api'

function timeAgo(dateStr) {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(ms) {
  if (!ms) return '—'
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

export default function SyncStatusTile() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [])

  async function loadData() {
    try {
      const res = await getSyncStatus()
      setData(res)
    } catch {
      // silently fail — sync service may not be deployed yet
    }
    setLoading(false)
  }

  if (loading) return null
  if (!data) return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-xs text-text-muted uppercase tracking-wide">GHL Sync</p>
      <p className="text-sm text-text-muted mt-1">Not connected</p>
    </div>
  )

  const isHealthy = data.status === 'healthy'
  const rc = data.record_counts || {}

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full p-4 text-left hover:bg-bg/50 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isHealthy ? 'bg-green-500' : 'bg-orange-500'}`} />
            <p className="text-xs text-text-muted uppercase tracking-wide font-semibold">GHL Sync</p>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2">
          <p className="text-sm text-text-primary"><span className="font-semibold">{(rc.contacts || 0).toLocaleString()}</span> <span className="text-text-muted">contacts</span></p>
          <p className="text-sm text-text-primary"><span className="font-semibold">{(rc.opportunities || 0).toLocaleString()}</span> <span className="text-text-muted">opportunities</span></p>
        </div>
        <p className="text-xs text-text-muted mt-2">
          Last sync: {timeAgo(data.last_delta_sync || data.last_full_sync)}
        </p>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
          {/* Sync timing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-text-muted uppercase">Last Full Sync</p>
              <p className="text-sm text-text-primary">{timeAgo(data.last_full_sync)}</p>
              <p className="text-xs text-text-muted">{formatDuration(data.last_full_duration_ms)}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted uppercase">Last Delta Sync</p>
              <p className="text-sm text-text-primary">{timeAgo(data.last_delta_sync)}</p>
              <p className="text-xs text-text-muted">{formatDuration(data.last_delta_duration_ms)}</p>
            </div>
          </div>

          {/* Record counts */}
          <div>
            <p className="text-xs text-text-muted uppercase mb-1">Record Counts</p>
            <div className="grid grid-cols-2 gap-1 text-sm">
              <span className="text-text-muted">Contacts:</span><span className="text-text-primary font-medium">{(rc.contacts || 0).toLocaleString()}</span>
              <span className="text-text-muted">Opportunities:</span><span className="text-text-primary font-medium">{(rc.opportunities || 0).toLocaleString()}</span>
              <span className="text-text-muted">Pipelines:</span><span className="text-text-primary font-medium">{rc.pipelines || 0}</span>
              <span className="text-text-muted">Locations:</span><span className="text-text-primary font-medium">{rc.locations || 0}</span>
            </div>
          </div>

          {/* Per-location breakdown */}
          {data.by_location && data.by_location.length > 0 && (
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Contacts by Location</p>
              <div className="space-y-1">
                {data.by_location.map(loc => (
                  <div key={loc.name} className="flex items-center justify-between text-sm">
                    <span className="text-text-muted">{loc.name}</span>
                    <span className="text-text-primary font-medium">{(loc.contacts || loc.count || 0).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent errors */}
          {data.recent_errors > 0 && (
            <div>
              <p className="text-xs text-orange-600 uppercase font-semibold">{data.recent_errors} recent error{data.recent_errors > 1 ? 's' : ''}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
