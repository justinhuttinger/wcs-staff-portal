import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import MobileHeader from './MobileHeader'
import { lookupInventoryUpc, adjustInventoryItem, getInventoryItems, getInventoryItemMovements } from '../../lib/api'
import { LOCATION_OPTIONS } from '../../config/locations'

function fmtMoney(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—'
}
function fmtQty(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
}

const MOVEMENT_LABELS = { sale: 'Sale', return: 'Return', received: 'Received', adjustment: 'Adjustment', count: 'Count' }

// Camera barcode scanner using @ericblade/quagga2 — same proven setup as the
// old portal's restock scanner (rear camera, 1D retail barcode readers).
function Scanner({ onDetected, onClose }) {
  const videoRef = useRef(null)
  const scannerRef = useRef(null)
  const [failed, setFailed] = useState(false)
  // Keep the callback in a ref so parent re-renders never tear down and
  // restart the camera stream mid-scan.
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected

  useEffect(() => {
    let stopped = false
    async function init() {
      try {
        const Quagga = (await import('@ericblade/quagga2')).default
        Quagga.init({
          inputStream: {
            name: 'Live', type: 'LiveStream', target: videoRef.current,
            constraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          },
          decoder: {
            readers: ['upc_reader', 'upc_e_reader', 'ean_reader', 'ean_8_reader', 'code_128_reader', 'code_39_reader'],
            multiple: false,
          },
          locate: true,
          locator: { patchSize: 'medium', halfSample: true },
        }, (err) => {
          if (err || stopped) { if (!stopped) setFailed(true); return }
          Quagga.start()
          scannerRef.current = Quagga
        })
        Quagga.onDetected((result) => {
          if (stopped) return
          const code = result?.codeResult?.code
          if (!code) return
          stopped = true
          Quagga.stop()
          scannerRef.current = null
          onDetectedRef.current(code)
        })
      } catch {
        if (!stopped) setFailed(true)
      }
    }
    init()
    return () => {
      stopped = true
      if (scannerRef.current) {
        try { scannerRef.current.stop() } catch { /* already stopped */ }
        try { scannerRef.current.offDetected() } catch { /* no listener */ }
        scannerRef.current = null
      }
    }
  }, [])

  // Portal to <body>: the app's content wrapper is `relative z-10`, which
  // traps any z-index inside it below the z-50 tab bar.
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-white text-sm font-semibold">{failed ? 'Camera unavailable' : 'Point at a barcode'}</p>
        <button onClick={onClose} className="text-white/80 text-sm font-semibold px-3 py-1.5 rounded-lg border border-white/30">Close</button>
      </div>
      <div className="relative flex-1 overflow-hidden [&_video]:w-full [&_video]:h-full [&_video]:object-cover [&_canvas]:hidden">
        <div ref={videoRef} className="absolute inset-0" />
        {!failed && (
          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 pointer-events-none">
            <div className="h-0.5 bg-wcs-red shadow-[0_0_12px_rgba(220,38,38,0.9)] animate-pulse" />
          </div>
        )}
        {failed && (
          <p className="absolute inset-x-6 top-1/3 text-center text-white/80 text-sm">
            Could not start the camera. Close and use manual UPC entry instead.
          </p>
        )}
      </div>
    </div>,
    document.body
  )
}

// Bottom sheets render through a portal to <body> at z-[60] (above the z-50
// tab bar — inside the app's `relative z-10` content wrapper they'd be
// trapped underneath it) and pad for the home indicator.
const SHEET_PAD = { paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }

function AdjustSheet({ item, onClose, onSaved }) {
  const [mode, setMode] = useState('delta') // delta (add only) | count
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const n = parseFloat(value)
    if (!Number.isFinite(n)) { setError('Enter a number'); return }
    if (mode === 'delta' && n <= 0) { setError('Enter a positive amount — removals are done in ABC'); return }
    if (mode === 'count' && n < 0) { setError('Count cannot be negative'); return }
    setSaving(true); setError('')
    try {
      const body = mode === 'count' ? { set_qty: n, note, source: 'mobile' } : { qty_delta: n, note, source: 'mobile' }
      const res = await adjustInventoryItem(item.id, body)
      onSaved(res.item)
      onClose()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-surface rounded-t-2xl w-full p-5 max-h-[85dvh] overflow-y-auto" style={SHEET_PAD} onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-text-primary mb-1">{item.item_name}</h3>
        <p className="text-xs text-text-muted mb-3">On hand: <span className="font-bold text-text-primary">{fmtQty(item.qty_on_hand)}</span></p>
        <div className="flex gap-1 bg-bg rounded-lg p-1 mb-3">
          {[{ key: 'delta', label: 'Add stock' }, { key: 'count', label: 'Set exact count' }].map(m => (
            <button key={m.key} onClick={() => setMode(m.key)}
              className={`flex-1 px-3 py-2 rounded-md text-xs font-medium ${mode === m.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'}`}>
              {m.label}
            </button>
          ))}
        </div>
        <input
          type="number" step="any" min="0" inputMode="decimal" autoFocus value={value} onChange={e => setValue(e.target.value)}
          placeholder={mode === 'count' ? 'Counted quantity' : 'Amount to add (e.g. 12)'}
          className="w-full px-3 py-3 rounded-xl border border-border bg-bg text-base text-text-primary mb-3"
        />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
          className="w-full px-3 py-3 rounded-xl border border-border bg-bg text-sm text-text-primary mb-3" />
        <p className="text-[11px] text-text-muted mb-3">Removals aren't done here — sales and write-offs go through ABC POS.</p>
        {error && <p className="text-xs text-wcs-red mb-3">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-muted">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-xl bg-wcs-red text-white text-sm font-semibold disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function MobileInventory({ user }) {
  const primarySlug = (user?.staff?.locations?.find(l => l.is_primary)?.name || user?.staff?.locations?.[0]?.name || 'Salem').toLowerCase()
  const [slug, setSlug] = useState(LOCATION_OPTIONS.some(o => o.slug === primarySlug) ? primarySlug : 'salem')
  const [scanning, setScanning] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [results, setResults] = useState([])
  const [adjusting, setAdjusting] = useState(null)
  const [history, setHistory] = useState(null) // { item, movements }
  const [browse, setBrowse] = useState([])
  const [browseQ, setBrowseQ] = useState('')
  const [browseLoading, setBrowseLoading] = useState(false)

  async function lookup(code) {
    if (!code) return
    setLookupLoading(true); setLookupError(''); setResults([])
    try {
      const res = await lookupInventoryUpc(code.trim(), { location_slug: slug })
      if ((res.items || []).length === 0) {
        setLookupError(`No item found for UPC ${code} at ${slug}.`)
      } else {
        setResults(res.items)
      }
    } catch (err) {
      setLookupError(err.message || 'Lookup failed')
    } finally { setLookupLoading(false) }
  }

  function onScanDetected(code) {
    setScanning(false)
    setManualCode(code)
    lookup(code)
  }

  // Browse/search the club's items (no barcode handy).
  useEffect(() => {
    const term = browseQ.trim()
    if (term.length < 2) { setBrowse([]); return }
    let cancelled = false
    setBrowseLoading(true)
    const t = setTimeout(() => {
      getInventoryItems({ location_slug: slug, q: term })
        .then(res => { if (!cancelled) setBrowse((res.items || []).slice(0, 20)) })
        .catch(() => {})
        .finally(() => { if (!cancelled) setBrowseLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [browseQ, slug])

  async function openHistory(item) {
    try {
      const res = await getInventoryItemMovements(item.id)
      setHistory({ item, movements: res.movements || [] })
    } catch { /* ignore */ }
  }

  const onSaved = (updated) => {
    setResults(list => list.map(i => i.id === updated.id ? updated : i))
    setBrowse(list => list.map(i => i.id === updated.id ? updated : i))
  }

  function ItemCard({ item }) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-4 mb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-text-primary text-sm">{item.item_name}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {[item.category, item.upc].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="text-right">
            <span className={`text-lg font-black ${Number(item.qty_on_hand) < 0 ? 'text-wcs-red' : Number(item.qty_on_hand) === 0 ? 'text-text-muted' : 'text-text-primary'}`}>
              {fmtQty(item.qty_on_hand)}
            </span>
            {Number(item.qty_on_hand) < 0 && (
              <p className="text-[9px] font-bold uppercase tracking-wide text-red-700">Oversold</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
          <span>Price {fmtMoney(item.abc_unit_price)}</span>
          {item.unit_cost != null && <span>Cost {fmtMoney(item.unit_cost)}</span>}
          {item.margin_pct != null && <span className={item.margin_pct < 0 ? 'text-wcs-red font-semibold' : 'text-emerald-600 font-semibold'}>{item.margin_pct}% margin</span>}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => setAdjusting(item)} className="flex-1 py-2 rounded-xl bg-wcs-red text-white text-xs font-semibold">Adjust Stock</button>
          <button onClick={() => openHistory(item)} className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold text-text-muted">History</button>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-4 px-4 pb-24">
      <MobileHeader
        title="Inventory"
        rightAction={<span className="px-2 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red text-[10px] font-bold uppercase tracking-wider border border-wcs-red/20">Beta</span>}
      />

      {/* Club selector */}
      <select
        value={slug} onChange={e => { setSlug(e.target.value); setResults([]); setLookupError('') }}
        className="w-full mt-3 mb-4 px-3 py-3 rounded-xl border border-border bg-surface text-sm text-text-primary"
      >
        {LOCATION_OPTIONS.filter(o => o.slug !== 'all').map(o => <option key={o.slug} value={o.slug}>{o.label}</option>)}
      </select>

      {/* Scan */}
      <button
        onClick={() => setScanning(true)}
        className="w-full py-4 rounded-2xl bg-wcs-red text-white font-bold text-sm flex items-center justify-center gap-2 mb-3"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 13.5h1.5v1.5h-1.5zM16.5 13.5H18v1.5h-1.5zM19.5 13.5H21v1.5h-1.5zM13.5 16.5h1.5V18h-1.5zM16.5 16.5H18V18h-1.5zM19.5 16.5H21V18h-1.5zM13.5 19.5h1.5V21h-1.5zM16.5 19.5H18V21h-1.5zM19.5 19.5H21V21h-1.5z" />
        </svg>
        Scan UPC Barcode
      </button>

      {/* Manual entry */}
      <form
        onSubmit={e => { e.preventDefault(); lookup(manualCode) }}
        className="flex gap-2 mb-4"
      >
        <input
          value={manualCode} onChange={e => setManualCode(e.target.value)}
          placeholder="Or type a UPC..." inputMode="numeric"
          className="flex-1 px-3 py-3 rounded-xl border border-border bg-surface text-sm text-text-primary"
        />
        <button type="submit" disabled={lookupLoading || !manualCode.trim()}
          className="px-4 rounded-xl border border-border bg-surface text-sm font-semibold text-text-primary disabled:opacity-50">
          {lookupLoading ? '...' : 'Look up'}
        </button>
      </form>

      {lookupError && (
        <p className="text-sm text-wcs-red bg-surface border border-border rounded-xl px-3 py-3 mb-4">{lookupError}</p>
      )}
      {results.map(item => <ItemCard key={item.id} item={item} />)}

      {/* Name search fallback — on a surface card so the label stays
          readable over the dark location-photo background */}
      <div className="mt-2 bg-surface border border-border rounded-2xl p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Search by name</p>
        <input
          value={browseQ} onChange={e => setBrowseQ(e.target.value)}
          placeholder="Item name..."
          className="w-full px-3 py-3 rounded-xl border border-border bg-bg text-sm text-text-primary"
        />
        {browseLoading && <p className="text-xs text-text-muted mt-2">Searching...</p>}
      </div>
      <div className="mt-3">
        {browse.map(item => <ItemCard key={item.id} item={item} />)}
      </div>

      {scanning && <Scanner onDetected={onScanDetected} onClose={() => setScanning(false)} />}
      {adjusting && <AdjustSheet item={adjusting} onClose={() => setAdjusting(null)} onSaved={onSaved} />}

      {history && createPortal(
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={() => setHistory(null)}>
          <div className="bg-surface rounded-t-2xl w-full p-5 max-h-[75dvh] overflow-y-auto" style={SHEET_PAD} onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-text-primary mb-3">{history.item.item_name} — History</h3>
            {history.movements.length === 0 && <p className="text-sm text-text-muted">No stock movements yet.</p>}
            {history.movements.map(m => (
              <div key={m.id} className="flex items-center justify-between py-2 border-b border-border/50 text-sm">
                <div>
                  <p className="text-text-primary font-medium">{MOVEMENT_LABELS[m.kind] || m.kind}</p>
                  <p className="text-xs text-text-muted">{fmtDateTime(m.occurred_at)}{(m.created_by_name || m.employee_name) ? ` · ${m.created_by_name || m.employee_name}` : m.source === 'abc_pos' ? ' · ABC POS' : ''}</p>
                </div>
                <span className={`font-bold ${Number(m.qty_delta) < 0 ? 'text-wcs-red' : 'text-emerald-600'}`}>
                  {Number(m.qty_delta) > 0 ? '+' : ''}{fmtQty(m.qty_delta)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
