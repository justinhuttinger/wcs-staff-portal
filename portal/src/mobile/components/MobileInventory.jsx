import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import MobileHeader from './MobileHeader'
import {
  lookupInventoryUpc, adjustInventoryItem, updateInventoryItem, getInventoryItems, getInventoryItemMovements,
  createInventoryInvoice, parseInventoryInvoice, addInventoryInvoiceFiles, deleteInventoryInvoiceFile,
  receiveInventoryInvoice, addInventoryInvoiceItem, deleteInventoryInvoiceItem,
} from '../../lib/api'
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

// Vendors we buy inventory from. "Other" covers anything one-off.
const VENDOR_OPTIONS = ['SportLife', 'Coke', 'Other']

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
    // Consensus filter: a single decode is sometimes a misread (works "on the
    // second try"). Require the SAME code on 2 consecutive frames, and reject
    // high-error decodes, before accepting — this kills the one-off misreads.
    let voteCode = null, voteCount = 0
    const REQUIRED_VOTES = 2
    // Keep the scanner in portrait so rotating the phone can't reflow or break
    // the camera feed. Works in the installed PWA / Android Chrome; iOS Safari
    // doesn't support programmatic lock, so it fails silently (CSS still fills).
    try { window.screen?.orientation?.lock?.('portrait')?.catch?.(() => {}) } catch { /* unsupported */ }
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
          // Reject low-confidence decodes (high average per-bar error) — these
          // are the misreads. Good 1D reads are typically well under 0.25.
          const errs = (result?.codeResult?.decodedCodes || []).map(d => d.error).filter(e => typeof e === 'number')
          const avgErr = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0
          if (avgErr > 0.25) return
          // Require the same code on consecutive frames before accepting.
          if (code === voteCode) voteCount++
          else { voteCode = code; voteCount = 1 }
          if (voteCount < REQUIRED_VOTES) return
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
      try { window.screen?.orientation?.unlock?.() } catch { /* unsupported */ }
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

// A dedicated, obvious full-screen loader (its own "page") for long async steps
// like reading an invoice or receiving into stock.
function FullScreenLoader({ title, subtitle }) {
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-surface flex flex-col items-center justify-center px-8 text-center">
      <div className="w-12 h-12 border-4 border-border border-t-wcs-red rounded-full animate-spin mb-4" />
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      {subtitle && <p className="text-xs text-text-muted mt-1">{subtitle}</p>}
    </div>,
    document.body
  )
}

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

// EditCostSheet: admin-only. Set the item's unit COST (price comes from ABC and
// is read-only). Margin is derived and shown live — never entered directly.
function EditCostSheet({ item, onClose, onSaved }) {
  const [cost, setCost] = useState(item.unit_cost != null ? String(item.unit_cost) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const price = Number(item.abc_unit_price)
  const costNum = parseFloat(cost)
  const margin = Number.isFinite(price) && price > 0 && Number.isFinite(costNum)
    ? +(((price - costNum) / price) * 100).toFixed(1)
    : null

  async function save() {
    if (cost !== '' && (!Number.isFinite(costNum) || costNum < 0)) { setError('Enter a valid cost'); return }
    setSaving(true); setError('')
    try {
      const res = await updateInventoryItem(item.id, { unit_cost: cost === '' ? null : costNum })
      onSaved(res.item)
      onClose()
    } catch (err) { setError(err.message || 'Save failed') } finally { setSaving(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-surface rounded-t-2xl w-full p-5" style={SHEET_PAD} onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-text-primary mb-3">{item.item_name}</h3>

        <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Price (from ABC)</label>
        <div className="w-full px-3 py-3 rounded-xl border border-border bg-bg/60 text-sm text-text-muted mb-3">{fmtMoney(item.abc_unit_price)}</div>

        <label className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Cost (per unit)</label>
        <input
          type="number" step="0.01" min="0" inputMode="decimal" autoFocus value={cost}
          onChange={e => setCost(e.target.value)} placeholder="0.00"
          className="w-full px-3 py-3 rounded-xl border border-border bg-bg text-base text-text-primary mb-3"
        />

        <p className="text-xs text-text-muted mb-3">
          Margin: {margin != null
            ? <span className={`font-semibold ${margin < 0 ? 'text-wcs-red' : 'text-emerald-600'}`}>{margin}%</span>
            : <span>—</span>}
        </p>

        {error && <p className="text-xs text-wcs-red mb-3">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-text-muted">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-xl bg-wcs-red text-white text-sm font-semibold disabled:opacity-50">
            {saving ? 'Saving...' : 'Save cost'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// InvoiceCaptureSheet: snap one or more pages, enter vendor, create + parse.
function InvoiceCaptureSheet({ slug, onClose, onParsed }) {
  const [vendor, setVendor] = useState('SportLife')
  const [orderNumber, setOrderNumber] = useState('')
  const [pages, setPages] = useState([]) // File[]
  const [previews, setPreviews] = useState([]) // { url, name, isImage }[]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)
  const previewsRef = useRef(previews)
  const locationLabel = LOCATION_OPTIONS.find(o => o.slug === slug)?.label || slug

  // Keep previewsRef in sync with previews state
  useEffect(() => {
    previewsRef.current = previews
  }, [previews])

  // Revoke object URLs on unmount only to avoid revoking URLs still in use
  useEffect(() => {
    return () => {
      previewsRef.current.forEach(p => { if (p.url) URL.revokeObjectURL(p.url) })
    }
  }, [])

  function addFiles(fileList) {
    const incoming = Array.from(fileList || [])
    if (!incoming.length) return
    const newPreviews = incoming.map(f => {
      const isImage = f.type.startsWith('image/')
      return { url: isImage ? URL.createObjectURL(f) : null, name: f.name, isImage }
    })
    setPages(prev => [...prev, ...incoming])
    setPreviews(prev => [...prev, ...newPreviews])
    // Reset file input so the same file can be re-added if needed
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removePage(idx) {
    setPreviews(prev => {
      if (prev[idx]?.url) URL.revokeObjectURL(prev[idx].url)
      return prev.filter((_, i) => i !== idx)
    })
    setPages(prev => prev.filter((_, i) => i !== idx))
  }

  async function readInvoice() {
    if (!vendor.trim() || !pages.length) return
    setBusy(true); setError('')
    try {
      const res = await createInventoryInvoice(
        { vendor: vendor.trim(), invoice_number: orderNumber || undefined, location_slug: slug },
        pages
      )
      let inv = res.invoice
      try {
        const parsed = await parseInventoryInvoice(inv.id)
        inv = parsed.invoice
      } catch {
        // Keep unparsed invoice so manager can review manually
      }
      onParsed(inv)
    } catch (err) {
      setError(err.message || 'Failed to create invoice')
    } finally {
      setBusy(false)
    }
  }

  if (busy) return <FullScreenLoader title="Reading invoice…" subtitle="Pulling vendor, items, and costs from the photo." />

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-surface rounded-t-2xl w-full p-5 max-h-[85dvh] overflow-y-auto" style={SHEET_PAD} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-bold text-text-primary">Snap Invoice</h3>
          <button onClick={onClose} className="text-text-muted text-sm px-2 py-1">Cancel</button>
        </div>
        <p className="text-xs text-text-muted mb-4">Adding to <span className="font-semibold text-text-primary">{locationLabel}</span></p>

        <select
          value={vendor} onChange={e => setVendor(e.target.value)}
          className="w-full px-3 py-3 rounded-xl border border-border bg-bg text-sm text-text-primary mb-3"
        >
          {VENDOR_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <input
          value={orderNumber} onChange={e => setOrderNumber(e.target.value)}
          placeholder="Order / invoice # (optional)"
          className="w-full px-3 py-3 rounded-xl border border-border bg-bg text-sm text-text-primary mb-4"
        />

        {/* Camera capture button */}
        <label className="block w-full py-4 rounded-2xl border-2 border-dashed border-border bg-bg text-center cursor-pointer mb-3">
          <span className="flex flex-col items-center gap-1.5 text-text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-7 h-7">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
            </svg>
            <span className="text-sm font-semibold">
              {pages.length === 0 ? 'Take photo / add page' : `Add another page (${pages.length} so far)`}
            </span>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            multiple
            className="hidden"
            onChange={e => addFiles(e.target.files)}
          />
        </label>

        {/* Page thumbnails */}
        {previews.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {previews.map((p, idx) => (
              <div key={(p.url || p.name) + '-' + idx} className="relative">
                {p.isImage ? (
                  <img src={p.url} alt={`Page ${idx + 1}`} className="w-16 h-16 object-cover rounded-lg border border-border" />
                ) : (
                  <div className="w-16 h-16 flex items-center justify-center rounded-lg border border-border bg-bg">
                    <span className="text-[9px] text-text-muted text-center px-1 break-all leading-tight">{p.name}</span>
                  </div>
                )}
                <button
                  onClick={() => removePage(idx)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-wcs-red text-white text-xs flex items-center justify-center leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-wcs-red mb-3">{error}</p>}

        <button
          onClick={readInvoice}
          disabled={busy || !vendor.trim() || pages.length === 0}
          className="w-full py-3 rounded-xl bg-wcs-red text-white text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Reading invoice...' : 'Read invoice'}
        </button>
      </div>
    </div>,
    document.body
  )
}

// InvoiceReviewSheet: review parsed lines, match items, receive into stock.
function InvoiceReviewSheet({ slug, invoice, onClose }) {
  const [lines, setLines] = useState(invoice.items || [])
  const [files, setFiles] = useState(invoice.files || [])
  const [parsing, setParsing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { applied, skipped }
  const [pickerLineId, setPickerLineId] = useState(null) // which line's picker is open
  const [pickerQ, setPickerQ] = useState('')
  const [pickerResults, setPickerResults] = useState([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [scanForLine, setScanForLine] = useState(null) // line whose barcode scanner is open
  const [scanMsg, setScanMsg] = useState('')
  const [matchChooseLine, setMatchChooseLine] = useState(null) // line showing the scan-vs-search popup
  const fileInputRef = useRef(null)

  // Debounced picker search — mirrors the browse-search pattern in the main component
  useEffect(() => {
    if (pickerLineId === null) { setPickerResults([]); setPickerQ(''); return }
    const term = pickerQ.trim()
    if (term.length < 2) { setPickerResults([]); return }
    let cancelled = false
    setPickerLoading(true)
    const t = setTimeout(() => {
      getInventoryItems({ location_slug: slug, q: term })
        .then(res => { if (!cancelled) setPickerResults((res.items || []).slice(0, 15)) })
        .catch(() => {})
        .finally(() => { if (!cancelled) setPickerLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [pickerQ, pickerLineId, slug])

  async function reparse() {
    setParsing(true); setError('')
    try {
      const res = await parseInventoryInvoice(invoice.id)
      setLines(res.invoice.items || [])
      setFiles(res.invoice.files || [])
    } catch (err) { setError(err.message || 'Re-read failed') } finally { setParsing(false) }
  }

  async function addPages(fileList) {
    const list = Array.from(fileList || [])
    if (!list.length) return
    setParsing(true); setError('')
    try {
      await addInventoryInvoiceFiles(invoice.id, list)
      await reparse()
    } catch (err) { setError(err.message || 'Upload failed'); setParsing(false) }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function relink(line, itemId, itemName) {
    setError('')
    try {
      await deleteInventoryInvoiceItem(invoice.id, line.id)
      const res = await addInventoryInvoiceItem(invoice.id, {
        item_id: itemId,
        description: line.description,
        quantity: Number(line.quantity),
        unit_cost: Number(line.unit_cost),
      })
      // Attach the matched name to the new item for display before next re-parse
      const newItem = { ...res.item, _matched_name: itemName }
      setLines(ls => ls.map(x => x.id === line.id ? newItem : x))
      setPickerLineId(null)
      setPickerQ('')
      setPickerResults([])
    } catch (err) { setError(err.message || 'Link failed') }
  }

  // Scan a barcode to resolve a line's catalog item by UPC. Exact single match
  // links immediately; otherwise we open the picker seeded with the scanned code.
  async function scanToLink(line, code) {
    setScanForLine(null)
    setScanMsg('')
    const upc = String(code || '').trim()
    if (!upc) return
    try {
      const res = await lookupInventoryUpc(upc, { location_slug: slug })
      const items = res.items || []
      if (items.length === 1) { await relink(line, items[0].id, items[0].item_name); return }
      setPickerLineId(line.id)
      setPickerResults([])
      if (items.length === 0) {
        setPickerQ('')
        setScanMsg(`No catalog item for UPC ${upc}. Search by name instead.`)
      } else {
        setPickerQ(upc) // search-by-UPC surfaces the candidates to choose from
      }
    } catch (err) { setPickerLineId(line.id); setScanMsg(err.message || 'UPC lookup failed') }
  }

  async function receive() {
    setBusy(true); setError(''); setResult(null)
    try {
      const r = await receiveInventoryInvoice(invoice.id)
      setResult(r)
      setLines(ls => ls.map(x => x.item_id ? { ...x, received: true } : x))
    } catch (err) { setError(err.message || 'Receive failed') } finally { setBusy(false) }
  }

  function confidencePill(line) {
    if (!line.match_source) return null
    const cls = line.match_confidence >= 0.85
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : line.match_confidence >= 0.6
        ? 'text-amber-700 bg-amber-50 border-amber-200'
        : 'text-text-muted bg-bg border-border'
    return (
      <span className={`text-[10px] font-bold uppercase rounded-full px-1.5 py-0.5 border ${cls}`}>
        {line.match_source}{line.match_confidence != null ? ` ${Math.round(line.match_confidence * 100)}%` : ''}
      </span>
    )
  }

  const allReceived = lines.length > 0 && lines.every(l => l.received)

  // Dedicated full-page loaders so reading and receiving are obviously working.
  if (parsing) return <FullScreenLoader title="Reading invoice…" subtitle="Pulling items and costs from the photo." />
  if (busy) return <FullScreenLoader title="Receiving into stock…" subtitle="Updating on-hand counts and item costs." />

  // Done screen with a clear Close action.
  if (result) {
    return createPortal(
      <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={onClose}>
        <div className="bg-surface rounded-t-2xl w-full p-6 text-center" style={SHEET_PAD} onClick={e => e.stopPropagation()}>
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-8 h-8 text-emerald-600"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          </div>
          <h3 className="text-lg font-bold text-text-primary">Received</h3>
          <p className="text-sm text-text-muted mt-1">
            {result.applied} line(s) received into stock{result.skipped > 0 ? `, ${result.skipped} skipped (no linked item)` : ''}.
          </p>
          <button onClick={onClose} className="w-full py-3 rounded-xl bg-wcs-red text-white text-sm font-semibold mt-5">Close</button>
        </div>
      </div>,
      document.body
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-surface rounded-t-2xl w-full p-5 max-h-[85dvh] overflow-y-auto" style={SHEET_PAD} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-base font-bold text-text-primary">{invoice.vendor}</h3>
            {invoice.invoice_number && <p className="text-xs text-text-muted">#{invoice.invoice_number}</p>}
          </div>
          <button onClick={onClose} className="text-text-muted text-sm px-2 py-1 shrink-0">Close</button>
        </div>
        {invoice.total != null && (
          <p className="text-xs text-text-muted mb-3">Total: <span className="font-semibold text-text-primary">{fmtMoney(invoice.total)}</span></p>
        )}

        {/* Page strip */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {files.map((f, i) => (
            <a
              key={f.id}
              href={f.file_link}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-wcs-red border border-wcs-red/30 bg-wcs-red/5 rounded-full px-2.5 py-1"
            >
              Page {f.page_no || i + 1}
            </a>
          ))}
          <label className="text-xs font-semibold text-text-muted border border-border rounded-full px-2.5 py-1 cursor-pointer">
            + Add page
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              multiple
              className="hidden"
              onChange={e => addPages(e.target.files)}
            />
          </label>
          <button
            onClick={reparse}
            disabled={parsing || files.length === 0}
            className="text-xs font-semibold text-text-muted border border-border rounded-full px-2.5 py-1 disabled:opacity-40"
          >
            {parsing ? 'Reading...' : 'Re-read'}
          </button>
        </div>

        {/* Lines */}
        {lines.length === 0 && !parsing && (
          <p className="text-sm text-text-muted mb-4">No line items parsed yet. Add pages and tap Re-read.</p>
        )}
        {parsing && <p className="text-sm text-text-muted mb-4">Reading invoice...</p>}

        {lines.map(line => {
          const matchedName = line._matched_name || line.matched_item_name
          const matchedUpc = line.matched_item_upc
          return (
          <div key={line.id} className="border border-border rounded-xl p-3 mb-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">
                  {matchedName || line.description || '—'}
                </p>
                {matchedName ? (
                  <p className="text-xs text-text-muted truncate">
                    {matchedUpc ? `UPC ${matchedUpc}` : 'Matched'}
                    {line.description && line.description !== matchedName ? ` · invoice: "${line.description}"` : ''}
                  </p>
                ) : null}
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-text-primary">{fmtQty(line.quantity)} × {fmtMoney(line.unit_cost)}</p>
              </div>
            </div>

            {/* Status / confidence */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {line.received ? (
                <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
                  Received
                </span>
              ) : (
                <>
                  {!line.item_id && (
                    <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                      Not linked
                    </span>
                  )}
                  {confidencePill(line)}
                </>
              )}
            </div>

            {/* Match picker (unreceived lines only) */}
            {!line.received && (
              <div className="mt-2">
                <button
                  onClick={() => { setScanMsg(''); setMatchChooseLine(line.id) }}
                  className="text-xs font-semibold text-wcs-red"
                >
                  {line.item_id ? 'Change match' : 'Match item'}
                </button>

                {scanMsg && pickerLineId === line.id && (
                  <p className="text-xs text-amber-700 mt-1.5">{scanMsg}</p>
                )}

                {pickerLineId === line.id && (
                  <div className="mt-2">
                    <input
                      autoFocus
                      value={pickerQ}
                      onChange={e => setPickerQ(e.target.value)}
                      placeholder="Search by name or UPC..."
                      className="w-full px-3 py-2 rounded-xl border border-border bg-bg text-sm text-text-primary"
                    />
                    {pickerLoading && <p className="text-xs text-text-muted mt-1">Searching...</p>}
                    {!pickerLoading && pickerQ.trim().length >= 2 && pickerResults.length === 0 && (
                      <p className="text-xs text-text-muted mt-1">No items found.</p>
                    )}
                    {pickerResults.map(item => (
                      <button
                        key={item.id}
                        onClick={() => relink(line, item.id, item.item_name)}
                        className="w-full text-left px-3 py-2 rounded-xl border border-border bg-bg text-sm text-text-primary mt-1"
                      >
                        <span className="font-medium">{item.item_name}</span>
                        {item.upc && <span className="text-xs text-text-muted ml-2">{item.upc}</span>}
                      </button>
                    ))}
                  </div>
                )}

                {scanForLine === line.id && (
                  <Scanner
                    onDetected={code => scanToLink(line, code)}
                    onClose={() => setScanForLine(null)}
                  />
                )}
              </div>
            )}
          </div>
          )
        })}

        {error && <p className="text-xs text-wcs-red mb-3">{error}</p>}

        {/* Receive button */}
        <button
          onClick={receive}
          disabled={parsing || allReceived || lines.length === 0}
          className="w-full py-3 rounded-xl bg-wcs-red text-white text-sm font-semibold disabled:opacity-50 mt-2"
        >
          {allReceived ? 'All received' : 'Receive into stock'}
        </button>
      </div>

      {/* Match method popup: scan with the camera, or search by name/UPC */}
      {matchChooseLine && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end" onClick={e => { e.stopPropagation(); setMatchChooseLine(null) }}>
          <div className="bg-surface rounded-t-2xl w-full p-5" style={SHEET_PAD} onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-text-primary mb-1">Match this item</h3>
            <p className="text-xs text-text-muted mb-4">How do you want to find it?</p>
            <button
              onClick={() => { const id = matchChooseLine; setMatchChooseLine(null); setScanMsg(''); setScanForLine(id) }}
              className="w-full py-3 rounded-xl bg-wcs-red text-white text-sm font-semibold mb-2 flex items-center justify-center gap-2"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.5v15M7.5 4.5v15M11.25 4.5v15M15 4.5v15M18 4.5v15M20.25 4.5v15" />
              </svg>
              Scan barcode
            </button>
            <button
              onClick={() => { const id = matchChooseLine; setMatchChooseLine(null); setScanMsg(''); setPickerLineId(id); setPickerQ(''); setPickerResults([]) }}
              className="w-full py-3 rounded-xl border border-border text-text-primary text-sm font-semibold mb-2 flex items-center justify-center gap-2"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.2-5.2m0 0A7.5 7.5 0 1 0 5.2 5.2a7.5 7.5 0 0 0 10.6 10.6Z" />
              </svg>
              Search by name or UPC
            </button>
            <button onClick={() => setMatchChooseLine(null)} className="w-full py-2.5 text-text-muted text-sm font-semibold">Cancel</button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

const ROLE_LVL = { team_member: 0, front_desk: 0, personal_trainer: 0, lead: 1, custom: 1, manager: 2, director: 3, corporate: 3, marketing: 3, admin: 4 }

export default function MobileInventory({ user }) {
  const isAdmin = user?.staff?.role === 'admin'
  // Leads don't see margin (financial view stays manager+).
  const canSeeFinancials = (ROLE_LVL[user?.staff?.role] ?? 0) >= ROLE_LVL.manager
  const primarySlug = (user?.staff?.locations?.find(l => l.is_primary)?.name || user?.staff?.locations?.[0]?.name || 'Salem').toLowerCase()
  const [slug, setSlug] = useState(LOCATION_OPTIONS.some(o => o.slug === primarySlug) ? primarySlug : 'salem')
  const [scanning, setScanning] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [results, setResults] = useState([])
  const [adjusting, setAdjusting] = useState(null)
  const [editing, setEditing] = useState(null) // item whose cost is being edited (admin)
  const [history, setHistory] = useState(null) // { item, movements }
  const [browse, setBrowse] = useState([])
  const [browseQ, setBrowseQ] = useState('')
  const [browseLoading, setBrowseLoading] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [reviewInvoice, setReviewInvoice] = useState(null)
  const searchRef = useRef(null)

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
          {canSeeFinancials && item.margin_pct != null && <span className={item.margin_pct < 0 ? 'text-wcs-red font-semibold' : 'text-emerald-600 font-semibold'}>{item.margin_pct}% margin</span>}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => setAdjusting(item)} className="flex-1 py-2 rounded-xl bg-wcs-red text-white text-xs font-semibold">Adjust Stock</button>
          {isAdmin && <button onClick={() => setEditing(item)} className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold text-text-muted">Edit Cost</button>}
          <button onClick={() => openHistory(item)} className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold text-text-muted">History</button>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-4 px-4 pb-24">
      <MobileHeader title="Inventory" />

      {/* Club selector */}
      <select
        value={slug} onChange={e => { setSlug(e.target.value); setResults([]); setLookupError('') }}
        className="w-full mt-3 mb-4 px-3 py-3 rounded-xl border border-border bg-surface text-sm text-text-primary"
      >
        {LOCATION_OPTIONS.filter(o => o.slug !== 'all').map(o => <option key={o.slug} value={o.slug}>{o.label}</option>)}
      </select>

      {/* Primary actions — three equal-size buttons */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <button
          onClick={() => setScanning(true)}
          className="py-4 rounded-2xl bg-wcs-red text-white font-bold text-xs flex flex-col items-center justify-center gap-1.5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 13.5h1.5v1.5h-1.5zM16.5 13.5H18v1.5h-1.5zM19.5 13.5H21v1.5h-1.5zM13.5 16.5h1.5V18h-1.5zM16.5 16.5H18V18h-1.5zM19.5 16.5H21V18h-1.5zM13.5 19.5h1.5V21h-1.5zM16.5 19.5H18V21h-1.5zM19.5 19.5H21V21h-1.5z" />
          </svg>
          Scan UPC
        </button>
        <button
          onClick={() => setCapturing(true)}
          className="py-4 rounded-2xl border border-border bg-surface text-text-primary font-semibold text-xs flex flex-col items-center justify-center gap-1.5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          Snap Invoice
        </button>
        <button
          onClick={() => { searchRef.current?.focus(); searchRef.current?.scrollIntoView({ block: 'center' }) }}
          className="py-4 rounded-2xl border border-border bg-surface text-text-primary font-semibold text-xs flex flex-col items-center justify-center gap-1.5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.2-5.2m0 0A7.5 7.5 0 1 0 5.2 5.2a7.5 7.5 0 0 0 10.6 10.6Z" />
          </svg>
          Search
        </button>
      </div>

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
          ref={searchRef}
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
      {editing && <EditCostSheet item={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {capturing && (
        <InvoiceCaptureSheet
          slug={slug}
          onClose={() => setCapturing(false)}
          onParsed={inv => { setCapturing(false); setReviewInvoice(inv) }}
        />
      )}
      {reviewInvoice && (
        <InvoiceReviewSheet
          slug={slug}
          invoice={reviewInvoice}
          onClose={() => setReviewInvoice(null)}
        />
      )}

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
        </div>,
        document.body
      )}
    </div>
  )
}
