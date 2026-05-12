import { useState, useEffect, useMemo, useRef } from 'react'
import { onlineJoin } from '../../lib/api'

// The prospects-documents service hosts the live widget at /widget/online-join.
// We iframe it with ?location= so the same file ships to Elementor + lives here.
const PROSPECTS_BASE = import.meta.env.VITE_PROSPECTS_API_URL || 'https://prospects-documents.onrender.com'

export default function OnlineJoinPreview() {
  const [locations, setLocations] = useState([])
  const [locationId, setLocationId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [bust, setBust] = useState(0) // cache-bust counter for the Refresh button
  const iframeRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const r = await onlineJoin.listLocations()
        if (cancelled) return
        const list = (r.locations || []).filter(l => l.active)
        setLocations(list)
        if (list.length > 0 && !locationId) setLocationId(list[0].wcs_location_id)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load locations')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const url = useMemo(() => {
    if (!locationId) return null
    return `${PROSPECTS_BASE}/widget/online-join?location=${encodeURIComponent(locationId)}&_=${bust}`
  }, [locationId, bust])

  const selectedLocation = locations.find(l => l.wcs_location_id === locationId)

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-900">
        <span className="font-semibold">Preview:</span> this is the live public widget. It hits the real production API and creates real signup rows when you fill in the form, so use test data. Steps 1–4 work fully; step 5 (PayPage) will show a 503 until <code className="font-mono">ABC_PPS_ID</code> is set on Render.
      </div>

      <div className="bg-surface border border-border rounded-xl p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs flex-1 min-w-[160px]">
          <span className="block text-text-muted mb-0.5">Location</span>
          <select
            value={locationId}
            onChange={e => setLocationId(e.target.value)}
            disabled={loading}
            className="w-full px-2.5 py-1 bg-bg border border-border rounded-lg text-xs focus:outline-none focus:border-wcs-red"
          >
            {locations.length === 0 && <option value="">{loading ? 'Loading…' : 'No active locations'}</option>}
            {locations.map(l => (
              <option key={l.wcs_location_id} value={l.wcs_location_id}>
                {l.display_name} ({l.wcs_location_id})
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => setBust(b => b + 1)}
          disabled={!locationId}
          className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary disabled:opacity-50"
          title="Reload the widget"
        >
          ↻ Refresh
        </button>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold"
          >
            Open in new tab ↗
          </a>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      {selectedLocation && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-bg/40 flex items-center justify-between">
            <div className="text-[11px] font-mono text-text-muted truncate">{url}</div>
            <div className="text-[10px] text-text-muted shrink-0 ml-2">
              ABC club #{selectedLocation.abc_club_number}
            </div>
          </div>
          <iframe
            ref={iframeRef}
            key={url}
            src={url}
            title={`Online Join preview — ${selectedLocation.display_name}`}
            className="w-full bg-white"
            style={{ minHeight: '760px', border: 'none', display: 'block' }}
          />
        </div>
      )}

      <p className="text-[11px] text-text-muted">
        Tip: paste-into-Elementor source is at <code className="font-mono">join-flow-widget.html</code> in the <span className="font-mono">prospects---documents</span> repo. The Elementor copy and this preview always render the same file (served from <code className="font-mono">/widget/online-join</code>).
      </p>
    </div>
  )
}
