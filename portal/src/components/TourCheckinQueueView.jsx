import React, { useState, useEffect, useMemo } from 'react'
import { tourAdmin } from '../lib/api'

// Admin-only desktop view of the live Tour Check-In queue. It embeds the exact
// same standalone app the front-desk iPad runs (/tour.html?token=<token>) in an
// iframe, so staff can work the tour queue — pick the tour member, set the
// outcome, book a Day One, add notes, save — identically to the iPad. Tokens are
// per-location and come from the authed admin list endpoint.
export default function TourCheckinQueueView({ location }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    tourAdmin.list()
      .then(r => {
        if (!alive) return
        const locs = r.locations || []
        setRows(locs)
        // Default to the location the portal is currently scoped to, else first.
        const match = locs.find(l => (l.name || '').toLowerCase() === (location || '').toLowerCase())
        setSelectedId((match || locs[0])?.location_id ?? null)
      })
      .catch(e => { if (alive) setError(e.message || 'Failed to load') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [location])

  const selected = useMemo(
    () => rows.find(r => r.location_id === selectedId) || null,
    [rows, selectedId]
  )
  const token = selected?.public_token || ''
  const url = token ? `${window.location.origin}/tour.html?token=${token}` : ''

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-6">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-xl font-bold text-text-primary">Tour Check-In</h2>
          <p className="text-sm text-text-muted">Live front-desk tour queue — same as the iPad.</p>
        </div>
        {rows.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-text-muted">Location</span>
            <select
              value={selectedId ?? ''}
              onChange={e => setSelectedId(Number(e.target.value))}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
            >
              {rows.map(r => (
                <option key={r.location_id} value={r.location_id}>{r.name}</option>
              ))}
            </select>
          </label>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 rounded-lg border border-border text-text-muted text-sm font-medium hover:text-text-primary hover:border-text-muted transition-colors"
            title="Open the check-in queue in a new tab"
          >
            Open in new tab ↗
          </a>
        )}
      </div>

      {loading ? (
        <p className="text-text-muted text-sm bg-surface/95 border border-border rounded-xl px-4 py-6 text-center">Loading…</p>
      ) : error ? (
        <p className="text-wcs-red text-sm bg-surface/95 border border-border rounded-xl px-4 py-6 text-center">{error}</p>
      ) : !token ? (
        <p className="text-text-muted text-sm bg-surface/95 border border-border rounded-xl px-4 py-6 text-center">
          No check-in link is configured for this location yet. Set one up under Admin → Tour Check-In.
        </p>
      ) : (
        <div
          className="rounded-2xl border border-border overflow-hidden bg-white shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
          style={{ height: 'min(78vh, 900px)' }}
        >
          <iframe
            key={token}
            src={url}
            title={`Tour Check-In — ${selected?.name || ''}`}
            className="w-full h-full border-0"
          />
        </div>
      )}
    </div>
  )
}
