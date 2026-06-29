import { useState, useEffect, useMemo, useRef } from 'react'
import { onlineJoin } from '../../lib/api'

// The prospects-documents service hosts the live widget at /widget/online-join.
// We iframe it with ?location= so the same file ships to Elementor + lives here.
const PROSPECTS_BASE = import.meta.env.VITE_PROSPECTS_API_URL || 'https://prospects-documents.onrender.com'

// Copy-to-clipboard button with the standard "Copied!" confirmation animation.
function CopyButton({ text, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <button
      onClick={handleCopy}
      className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${className} ${copied ? 'bg-green-100 text-green-700 border-green-300' : 'bg-wcs-red text-white border-wcs-red'}`}
    >
      <span className={copied ? 'opacity-0' : 'opacity-100'}>{label}</span>
      {copied && (
        <span className="absolute inset-0 flex items-center justify-center gap-1 text-green-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          Copied!
        </span>
      )}
    </button>
  )
}

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

  // Production embed for pasting onto a website (Elementor HTML widget, etc.).
  // Same URL as the preview but without the cache-bust param, and with a stable
  // responsive iframe wrapper that matches how the widget renders here.
  const embedUrl = locationId
    ? `${PROSPECTS_BASE}/widget/online-join?location=${encodeURIComponent(locationId)}`
    : null
  const embedCode = embedUrl
    ? `<iframe src="${embedUrl}" title="Join West Coast Strength${selectedLocation ? ` — ${selectedLocation.display_name}` : ''}" style="width:100%;min-height:760px;border:none;display:block" loading="lazy"></iframe>`
    : ''

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

      {embedUrl && (
        <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Embed on a website</h3>
              <p className="text-xs text-text-muted mt-0.5">
                Paste this into an Elementor HTML widget (or any page) to embed the Join flow for{' '}
                <span className="font-semibold text-text-primary">{selectedLocation?.display_name || 'this location'}</span>.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <CopyButton text={embedUrl} label="Copy link" className="!bg-transparent !text-text-muted !border-border hover:!text-text-primary" />
              <CopyButton text={embedCode} label="Copy embed code" />
            </div>
          </div>
          <pre className="bg-bg border border-border rounded-lg p-3 text-[11px] font-mono text-text-primary whitespace-pre-wrap break-all select-all">{embedCode}</pre>
          <p className="text-[11px] text-text-muted">
            The embed and this preview render the same file (served from <code className="font-mono">/widget/online-join</code> in <span className="font-mono">prospects---documents</span>), so edits in these admin tabs apply to the embedded widget automatically.
          </p>
        </div>
      )}
    </div>
  )
}
