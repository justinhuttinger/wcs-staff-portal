import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getInventoryItems, getInventoryCategories, getInventoryItemMovements,
  adjustInventoryItem, updateInventoryItem, getInventorySummary,
  getInventoryInvoices, createInventoryInvoice, parseInventoryInvoice, addInventoryInvoiceFiles,
  deleteInventoryInvoiceFile, addInventoryInvoiceItem,
  deleteInventoryInvoiceItem, receiveInventoryInvoice, deleteInventoryInvoice,
  startInventorySync, getInventorySyncStatus, getInventoryAudit,
} from '../lib/api'
import { LOCATION_OPTIONS } from '../config/locations'

// --- helpers ---
function fmtMoney(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
function fmtQty(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
}
function clubLabel(inv) {
  if (!inv.location_slug) return 'Corporate'
  return LOCATION_OPTIONS.find(o => o.slug === inv.location_slug)?.label || inv.location_slug
}
// Summarize an invoice's line state for the Restock list: total/matched/received
// counts plus a single status label (Pending → Partial → Received, or read state).
function invoiceLineSummary(inv) {
  const lines = inv.items || []
  const matched = lines.filter(l => l.item_id).length
  const received = lines.filter(l => l.received).length
  let status = 'Pending'
  if (inv.parse_status === 'error') status = 'Read failed'
  else if (lines.length === 0) status = 'No items'
  else if (matched > 0 && received >= matched) status = 'Received'
  else if (received > 0) status = 'Partial'
  return { total: lines.length, matched, received, status }
}
const RESTOCK_STATUS_CLS = {
  Received: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  Partial: 'text-amber-700 bg-amber-50 border-amber-200',
  Pending: 'text-text-muted bg-bg border-border',
  'No items': 'text-text-muted bg-bg border-border',
  'Read failed': 'text-red-700 bg-red-50 border-red-200',
}
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysAgoStr(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toLocalDateStr(d)
}

const QUICK_RANGES = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'last_90', label: 'Last 90 Days' },
  { key: 'ytd', label: 'YTD' },
]
function quickRange(key) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  switch (key) {
    case 'this_month': return { from: toLocalDateStr(new Date(y, m, 1)), to: toLocalDateStr(now) }
    case 'last_month': return { from: toLocalDateStr(new Date(y, m - 1, 1)), to: toLocalDateStr(new Date(y, m, 0)) }
    case 'last_30': return { from: daysAgoStr(29), to: toLocalDateStr(now) }
    case 'last_90': return { from: daysAgoStr(89), to: toLocalDateStr(now) }
    case 'ytd': return { from: toLocalDateStr(new Date(y, 0, 1)), to: toLocalDateStr(now) }
    default: return { from: daysAgoStr(30), to: toLocalDateStr(now) }
  }
}

const MOVEMENT_LABELS = {
  sale: 'Sale', return: 'Return', received: 'Received', adjustment: 'Stock Added', count: 'Count',
}

// Reorder points by ABC catalog category — an item lands on the To Order list
// when on-hand drops below the point for its category. Categories without a
// point (Merchandise, Tanning) are not reorder-tracked.
const REORDER_THRESHOLDS = { Drinks: 12, Snacks: 12, Supplements: 4 }
// How far back a depleted (0 / oversold) item must have sold to still count as
// worth reordering — dead stock that hasn't moved drops off the list.
const REORDER_SOLD_WINDOW_DAYS = 30

// Audit issue metadata — label + severity styling + what it means.
const AUDIT_ISSUES = {
  negative_margin: { label: 'Losing Money', cls: 'bg-red-50 text-red-700 border-red-200', desc: 'Cost is at or above the sale price' },
  selling_below_price: { label: 'Sold Below Price', cls: 'bg-red-50 text-red-700 border-red-200', desc: 'Actual sold price is under 90% of catalog price (heavy discounting)' },
  negative_stock: { label: 'Oversold', cls: 'bg-red-50 text-red-700 border-red-200', desc: 'Sold more than we had on record (on-hand is negative) — recount, and check for missed receiving or shrinkage' },
  low_margin: { label: 'Low Margin', cls: 'bg-amber-50 text-amber-700 border-amber-200', desc: 'Margin is under the threshold' },
  no_cost: { label: 'No Cost Data', cls: 'bg-amber-50 text-amber-700 border-amber-200', desc: 'Sells or holds stock but no invoice cost on file' },
  no_price: { label: 'No Price', cls: 'bg-amber-50 text-amber-700 border-amber-200', desc: 'No catalog price from ABC' },
  missing_upc: { label: 'No UPC', cls: 'bg-bg text-text-muted border-border', desc: 'Cannot be scanned on mobile' },
  no_category: { label: 'No Category', cls: 'bg-amber-50 text-amber-700 border-amber-200', desc: 'No ABC category — add one in ABC and it fixes on the next 3am sync' },
}

const inputCls = 'px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red w-full'
const btnPrimary = 'px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'
const btnGhost = 'px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text-muted hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-50'

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`bg-surface rounded-2xl border border-border shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[85vh] flex flex-col p-5`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="text-lg font-bold text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto min-h-0">{children}</div>
      </div>
    </div>
  )
}

// Adjust stock modal: add stock or set an exact counted quantity. Removals
// happen in ABC POS only, so the delta path accepts positive numbers.
function AdjustModal({ item, onClose, onSaved }) {
  const [mode, setMode] = useState('delta') // delta (add) | count
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
      const body = mode === 'count' ? { set_qty: n, note } : { qty_delta: n, note }
      const res = await adjustInventoryItem(item.id, body)
      onSaved(res.item)
      onClose()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal title={`Adjust — ${item.item_name}`} onClose={onClose}>
      <p className="text-xs text-text-muted mb-3">Current on hand: <span className="font-bold text-text-primary">{fmtQty(item.qty_on_hand)}</span></p>
      <div className="flex gap-1 bg-bg rounded-lg p-1 mb-3">
        {[{ key: 'delta', label: 'Add stock' }, { key: 'count', label: 'Set exact count' }].map(m => (
          <button key={m.key} onClick={() => setMode(m.key)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === m.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
            {m.label}
          </button>
        ))}
      </div>
      <input
        type="number" step="any" min="0" autoFocus value={value} onChange={e => setValue(e.target.value)}
        placeholder={mode === 'count' ? 'Counted quantity' : 'Amount to add (e.g. 12)'}
        className={inputCls + ' mb-3'}
      />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={inputCls + ' mb-3'} />
      <p className="text-[11px] text-text-muted mb-3">Removals aren't done here — sales and write-offs go through ABC POS.</p>
      {error && <p className="text-xs text-wcs-red mb-3">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </Modal>
  )
}

// Admin-only item editor. Price stays read-only (it comes from ABC); cost is
// set here (or via received invoices) since ABC doesn't carry cost. UPC is
// editable to fix unscannable items.
function EditItemModal({ item, allClubs = false, onClose, onSaved }) {
  const [cost, setCost] = useState(item.unit_cost != null ? String(item.unit_cost) : '')
  const [upc, setUpc] = useState(item.upc || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    let costVal = null
    if (cost.trim() !== '') {
      costVal = parseFloat(cost)
      if (!Number.isFinite(costVal) || costVal < 0) { setError('Cost must be a non-negative number'); return }
    }
    setSaving(true); setError('')
    try {
      const res = await updateInventoryItem(item.id, { unit_cost: costVal, upc: upc.trim(), apply_all_clubs: allClubs })
      onSaved(res.item)
      onClose()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal title={`Edit — ${item.item_name}`} onClose={onClose}>
      <div className="space-y-3">
        {allClubs && (
          <p className="text-[11px] text-text-primary bg-wcs-red/5 border border-wcs-red/20 rounded-lg px-3 py-2">
            Editing for <span className="font-semibold">all clubs</span> — the cost and UPC you save apply to every club that carries this product.
          </p>
        )}
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Sale price (from ABC — read only)</span>
          <input value={fmtMoney(item.abc_unit_price)} disabled className={inputCls + ' opacity-60'} />
        </div>
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Cost per item ($)</span>
          <input type="number" step="0.01" min="0" autoFocus value={cost} onChange={e => setCost(e.target.value)}
            placeholder="What you pay the vendor per unit" className={inputCls} />
          <p className="text-[11px] text-text-muted mt-1.5">Used for margin and profit math. Receiving an invoice for this item updates it too. Leave blank to clear.</p>
        </div>
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">UPC</span>
          <input value={upc} onChange={e => setUpc(e.target.value)} inputMode="numeric"
            placeholder="Barcode number" className={inputCls} />
        </div>
        {error && <p className="text-xs text-wcs-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}

function HistoryModal({ item, onClose }) {
  const [movements, setMovements] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    getInventoryItemMovements(item.id)
      .then(res => setMovements(res.movements || []))
      .catch(err => setError(err.message))
  }, [item.id])
  return (
    <Modal title={`History — ${item.item_name}`} onClose={onClose} wide>
      {error && <p className="text-xs text-wcs-red">{error}</p>}
      {!movements && !error && <p className="text-sm text-text-muted">Loading...</p>}
      {movements && movements.length === 0 && <p className="text-sm text-text-muted">No sales or stock movements yet.</p>}
      {movements && movements.length > 0 && (
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
                <th className="py-2 pr-3">When</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3 text-right">Change</th>
                <th className="py-2 pr-3 text-right">Price</th><th className="py-2 pr-3 text-right">Cost</th><th className="py-2 pr-3">By / Note</th>
              </tr>
            </thead>
            <tbody>
              {movements.map(m => (
                <tr key={m.id} className="border-b border-border/50">
                  <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(m.occurred_at)}</td>
                  <td className="py-2 pr-3">{MOVEMENT_LABELS[m.kind] || m.kind}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${Number(m.qty_delta) < 0 ? 'text-wcs-red' : 'text-emerald-600'}`}>
                    {Number(m.qty_delta) > 0 ? '+' : ''}{fmtQty(m.qty_delta)}
                  </td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(m.unit_price)}</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(m.unit_cost)}</td>
                  <td className="py-2 pr-3 text-text-muted text-xs">{[m.created_by_name || m.employee_name, m.note].filter(Boolean).join(' — ') || (m.source === 'abc_pos' ? 'ABC POS' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

// Searchable catalog-item picker used on invoice lines.
function ItemPicker({ items, value, onChange }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const selected = items.find(i => i.id === value)
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return items.slice(0, 25)
    return items.filter(i =>
      (i.item_name || '').toLowerCase().includes(term) || (i.upc || '').includes(term)
    ).slice(0, 25)
  }, [items, q])
  return (
    <div className="relative">
      <input
        value={open ? q : (selected ? `${selected.item_name} (${selected.location_slug})` : q)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { setQ(e.target.value); if (value) onChange(null) }}
        placeholder="Link catalog item (search name or UPC)"
        className={inputCls}
      />
      {open && (
        <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {matches.length === 0 && <p className="px-3 py-2 text-xs text-text-muted">No matches</p>}
          {matches.map(i => (
            <button key={i.id} type="button"
              onMouseDown={() => { onChange(i.id); setQ(''); setOpen(false) }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-bg">
              <span className="font-medium text-text-primary">{i.item_name}</span>
              <span className="text-xs text-text-muted ml-2">{i.location_slug}{i.upc ? ` · ${i.upc}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function InvoiceModal({ onClose, onCreated, defaultSlug }) {
  const [vendor, setVendor] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(toLocalDateStr(new Date()))
  const [total, setTotal] = useState('')
  const [slug, setSlug] = useState(defaultSlug || 'all')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!vendor.trim()) { setError('Vendor is required'); return }
    setSaving(true); setError('')
    try {
      const res = await createInventoryInvoice({
        vendor: vendor.trim(),
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        total,
        notes,
        location_slug: slug === 'all' ? '' : slug,
      }, files)
      let invoice = res.invoice
      if (files.length) {
        try { const p = await parseInventoryInvoice(invoice.id); invoice = p.invoice } catch (_) { /* keep manual entry */ }
      }
      // onCreated owns the next step (close, or jump straight to the detail to
      // review/receive) — calling onClose() here would clobber that transition.
      onCreated(invoice)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal title="New Invoice" onClose={onClose}>
      <div className="space-y-3">
        <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor *" className={inputCls} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="Invoice #" className={inputCls} />
          <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input type="number" step="0.01" value={total} onChange={e => setTotal(e.target.value)} placeholder="Invoice total ($)" className={inputCls} />
          <select value={slug} onChange={e => setSlug(e.target.value)} className={inputCls}>
            {LOCATION_OPTIONS.map(o => <option key={o.slug} value={o.slug}>{o.slug === 'all' ? 'Corporate / Multi-club' : o.label}</option>)}
          </select>
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" rows={2} className={inputCls} />
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Invoice pages (PDF or photos — attach all pages)</span>
          <input type="file" accept="application/pdf,image/*" multiple capture="environment"
            onChange={e => setFiles(Array.from(e.target.files || []))} className="text-xs text-text-muted" />
          {files.length > 0 && <p className="text-[11px] text-text-muted mt-1">{files.length} page(s) selected</p>}
        </div>
        {error && <p className="text-xs text-wcs-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? (files.length ? 'Reading invoice...' : 'Saving...') : 'Create Invoice'}</button>
        </div>
      </div>
    </Modal>
  )
}

// Invoice detail: line items + receive-into-stock. Loads its own catalog
// scoped to the invoice's club (corporate invoices search every club).
function InvoiceDetail({ invoice, onClose, onChanged }) {
  const [items, setItems] = useState([])
  const [lines, setLines] = useState(invoice.items || [])
  const [desc, setDesc] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [linkedItem, setLinkedItem] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [files, setFiles] = useState(invoice.files || [])
  const [parsing, setParsing] = useState(false)

  useEffect(() => {
    getInventoryItems({ location_slug: invoice.location_slug || '' })
      .then(res => setItems(res.items || []))
      .catch(() => {})
  }, [invoice.id, invoice.location_slug])

  async function reparse() {
    setParsing(true); setError('')
    try {
      const res = await parseInventoryInvoice(invoice.id)
      setLines(res.invoice.items || [])
      setFiles(res.invoice.files || [])
      onChanged()
    } catch (err) { setError(err.message) } finally { setParsing(false) }
  }

  async function addPages(fileList) {
    const list = Array.from(fileList || [])
    if (!list.length) return
    setParsing(true); setError('')
    try {
      await addInventoryInvoiceFiles(invoice.id, list)
      await reparse()
    } catch (err) { setError(err.message); setParsing(false) }
  }

  async function removePage(fileId) {
    try { await deleteInventoryInvoiceFile(invoice.id, fileId); setFiles(f => f.filter(x => x.id !== fileId)) }
    catch (err) { setError(err.message) }
  }

  async function relink(line, itemId) {
    try {
      await deleteInventoryInvoiceItem(invoice.id, line.id)
      const res = await addInventoryInvoiceItem(invoice.id, {
        item_id: itemId, description: line.description, quantity: Number(line.quantity), unit_cost: Number(line.unit_cost),
      })
      setLines(l => l.map(x => x.id === line.id ? res.item : x)); onChanged()
    } catch (err) { setError(err.message) }
  }

  async function addLine() {
    const q = parseFloat(qty), c = parseFloat(cost)
    if (!Number.isFinite(q) || q <= 0) { setError('Quantity must be positive'); return }
    if (!Number.isFinite(c) || c < 0) { setError('Unit cost is required'); return }
    setBusy(true); setError('')
    try {
      const res = await addInventoryInvoiceItem(invoice.id, {
        item_id: linkedItem, description: desc, quantity: q, unit_cost: c,
      })
      setLines(l => [...l, res.item])
      setDesc(''); setQty(''); setCost(''); setLinkedItem(null)
      onChanged()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function removeLine(lineId) {
    try {
      await deleteInventoryInvoiceItem(invoice.id, lineId)
      setLines(l => l.filter(x => x.id !== lineId))
      onChanged()
    } catch (err) { setError(err.message) }
  }

  async function receive() {
    setBusy(true); setError('')
    try {
      const res = await receiveInventoryInvoice(invoice.id)
      setLines(l => l.map(x => x.item_id ? { ...x, received: true } : x))
      onChanged()
      if (res.skipped > 0) setError(`${res.applied} line(s) received; ${res.skipped} skipped (no linked catalog item)`)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const itemName = (id) => items.find(i => i.id === id)?.item_name || '—'
  const unreceived = lines.filter(l => !l.received)

  return (
    <Modal title={`${invoice.vendor}${invoice.invoice_number ? ` #${invoice.invoice_number}` : ''}`} onClose={onClose} wide>
      <div className="flex items-center gap-3 text-xs text-text-muted mb-4 flex-wrap">
        {invoice.invoice_date && <span>{invoice.invoice_date}</span>}
        {invoice.total != null && <span>Total: <span className="font-semibold text-text-primary">{fmtMoney(invoice.total)}</span></span>}
        {invoice.location_slug && <span className="capitalize">{invoice.location_slug}</span>}
        {invoice.file_link && <a href={invoice.file_link} target="_blank" rel="noreferrer" className="text-wcs-red font-semibold hover:underline">View file</a>}
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-4">
        {files.map((f, i) => (
          <span key={f.id} className="inline-flex items-center gap-1 text-xs bg-bg border border-border rounded-full px-2 py-1">
            <a href={f.file_link} target="_blank" rel="noreferrer" className="text-wcs-red font-semibold hover:underline">Page {f.page_no || i + 1}</a>
            <button type="button" onClick={() => removePage(f.id)} className="text-text-muted hover:text-wcs-red" title="Remove page">×</button>
          </span>
        ))}
        <label className="text-xs font-semibold text-wcs-red cursor-pointer hover:underline">
          + Add page
          <input type="file" accept="application/pdf,image/*" capture="environment" multiple className="hidden"
            onChange={e => addPages(e.target.files)} />
        </label>
        <button type="button" onClick={reparse} disabled={parsing || !files.length} className={btnGhost}>
          {parsing ? 'Reading...' : 'Re-read invoice'}
        </button>
      </div>

      {lines.length > 0 && (
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
              <th className="py-2 pr-3">Item</th><th className="py-2 pr-3 text-right">Qty</th>
              <th className="py-2 pr-3 text-right">Unit Cost</th><th className="py-2 pr-3 text-right">Line Total</th>
              <th className="py-2 pr-3">Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.id} className="border-b border-border/50">
                <td className="py-2 pr-3">
                  <span className="font-medium text-text-primary">{l.item_id ? (l.matched_item_name || itemName(l.item_id)) : (l.description || '—')}</span>
                  {l.item_id && l.matched_item_upc && <span className="text-xs text-text-muted ml-2">UPC {l.matched_item_upc}</span>}
                  {l.item_id && l.description && <span className="text-xs text-text-muted ml-2">from “{l.description}”</span>}
                  {!l.item_id && <span className="ml-2 text-[10px] font-bold uppercase text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">Not linked</span>}
                  {!l.received && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="min-w-[220px]"><ItemPicker items={items} value={l.item_id} onChange={(id) => id && relink(l, id)} /></div>
                      {l.match_source && (
                        <span className={`text-[10px] font-bold uppercase rounded-full px-1.5 py-0.5 border ${
                          l.match_confidence >= 0.85 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : l.match_confidence >= 0.6 ? 'text-amber-700 bg-amber-50 border-amber-200'
                          : 'text-text-muted bg-bg border-border'}`}>
                          {l.match_source}{l.match_confidence != null ? ` ${Math.round(l.match_confidence * 100)}%` : ''}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 text-right">{fmtQty(l.quantity)}</td>
                <td className="py-2 pr-3 text-right">{fmtMoney(l.unit_cost)}</td>
                <td className="py-2 pr-3 text-right">{fmtMoney(Number(l.quantity) * Number(l.unit_cost))}</td>
                <td className="py-2 pr-3">
                  {l.received
                    ? <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">Received</span>
                    : <span className="text-[10px] font-bold uppercase text-text-muted bg-bg border border-border rounded-full px-1.5 py-0.5">Pending</span>}
                </td>
                <td className="py-2 text-right">
                  {!l.received && (
                    <button onClick={() => removeLine(l.id)} className="text-text-muted hover:text-wcs-red p-1" title="Remove line">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="bg-bg rounded-xl p-3 mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Add line item</p>
        <div className="space-y-2">
          <ItemPicker items={items} value={linkedItem} onChange={setLinkedItem} />
          <div className="grid grid-cols-3 gap-2">
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description" className={inputCls} />
            <input type="number" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="Qty" className={inputCls} />
            <input type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)} placeholder="Unit cost ($)" className={inputCls} />
          </div>
          <div className="flex justify-end">
            <button className={btnGhost} onClick={addLine} disabled={busy}>Add Line</button>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-wcs-red mb-3">{error}</p>}
      <div className="flex justify-between items-center">
        <p className="text-xs text-text-muted">Receiving adds each linked line to stock and updates the item's cost.</p>
        <button className={btnPrimary} onClick={receive} disabled={busy || unreceived.filter(l => l.item_id).length === 0}>
          {busy ? 'Working...' : `Receive into Stock (${unreceived.filter(l => l.item_id).length})`}
        </button>
      </div>
    </Modal>
  )
}

// Sortable column header. Click cycles: desc → asc → no sort.
function SortHeader({ label, col, sort, onSort, align = 'right' }) {
  const active = sort?.col === col
  return (
    <th className={`py-2.5 px-2 text-${align}`}>
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 uppercase text-[10px] tracking-wider font-semibold transition-colors ${active ? 'text-wcs-red' : 'text-text-muted hover:text-text-primary'}`}
      >
        {label}
        <span className="w-2.5 inline-block">
          {active && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5">
              {sort.dir === 'desc'
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />}
            </svg>
          )}
        </span>
      </button>
    </th>
  )
}

export default function InventoryView({ onBack, location, isAdmin }) {
  const [tab, setTab] = useState('items') // items | profit (Sales) | audit (admin)
  const [slug, setSlug] = useState('all') // default to all clubs; dropdown can narrow
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [orderItems, setOrderItems] = useState([]) // items carrying sold_in_range over the reorder window, for the To Order tab
  const [invoices, setInvoices] = useState([])
  const [summary, setSummary] = useState([])
  const [from, setFrom] = useState(daysAgoStr(30))
  const [to, setTo] = useState(toLocalDateStr(new Date()))
  const [sort, setSort] = useState(null) // { col, dir: 'desc' | 'asc' } | null
  const [salesSort, setSalesSort] = useState(null) // Sales tab sort, same shape
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(null) // { adjust } | { history } | { newInvoice } | { invoice }
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [audit, setAudit] = useState(null) // { items, scanned, min_margin, days }
  const [auditIssueFilter, setAuditIssueFilter] = useState('')
  const [oversoldOnly, setOversoldOnly] = useState(false)

  const loadItems = useCallback(() => {
    setItemsLoading(true)
    getInventoryItems({ location_slug: slug === 'all' ? '' : slug })
      .then(res => setItems(res.items || []))
      .catch(err => setError(err.message))
      .finally(() => setItemsLoading(false))
  }, [slug])

  useEffect(() => { loadItems() }, [loadItems])
  useEffect(() => {
    getInventoryCategories().then(res => setCategories(res.categories || [])).catch(() => {})
    getInventorySyncStatus().then(setSyncStatus).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'profit') {
      setLoading(true)
      getInventorySummary({ location_slug: slug === 'all' ? '' : slug, from, to })
        .then(res => setSummary(res.summary || []))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    } else if (tab === 'audit') {
      setLoading(true)
      getInventoryAudit({ location_slug: slug === 'all' ? '' : slug })
        .then(setAudit)
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    } else if (tab === 'order') {
      // Pull per-club items with units sold over the reorder window so depleted
      // items can be filtered to ones that actually still sell.
      setLoading(true)
      getInventoryItems({
        location_slug: slug === 'all' ? '' : slug,
        from: daysAgoStr(REORDER_SOLD_WINDOW_DAYS),
        to: toLocalDateStr(new Date()),
      })
        .then(res => setOrderItems(res.items || []))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    } else if (tab === 'restock') {
      setLoading(true)
      getInventoryInvoices()
        .then(res => setInvoices(res.invoices || []))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [tab, slug, from, to])

  async function syncNow() {
    setSyncBusy(true); setError('')
    try {
      await startInventorySync('all', slug === 'all' ? undefined : slug)
      setTimeout(() => getInventorySyncStatus().then(setSyncStatus).catch(() => {}), 3000)
    } catch (err) { setError(err.message) } finally { setSyncBusy(false) }
  }

  // Click a sortable header: desc → asc → clear.
  function cycleSort(col) {
    setSort(s => {
      if (!s || s.col !== col) return { col, dir: 'desc' }
      if (s.dir === 'desc') return { col, dir: 'asc' }
      return null
    })
  }
  function cycleSalesSort(col) {
    setSalesSort(s => {
      if (!s || s.col !== col) return { col, dir: 'desc' }
      if (s.dir === 'desc') return { col, dir: 'asc' }
      return null
    })
  }

  const SORT_VALUE = {
    price: i => Number(i.abc_unit_price),
    cost: i => Number(i.unit_cost),
    margin: i => Number(i.margin_pct),
    sold: i => Number(i.sold_in_range),
    on_hand: i => Number(i.qty_on_hand),
  }

  // On the All-clubs view we show one consolidated row per product (same UPC):
  // on-hand and units-sold sum across clubs, price/cost are shared. Each row
  // keeps its underlying per-club items in `_members` for edit/adjust actions.
  // When a club is selected, every item is its own singleton row.
  const itemRows = useMemo(() => {
    const mk = (members) => {
      const rep = members[0]
      const price = Number(rep.abc_unit_price)
      const cost = Number(rep.unit_cost)
      const qty = members.reduce((s, m) => s + (Number(m.qty_on_hand) || 0), 0)
      const sold = members.reduce((s, m) => s + (Number(m.sold_in_range) || 0), 0)
      return {
        id: rep.id,
        item_name: rep.item_name,
        upc: rep.upc,
        category: rep.category,
        location_slug: rep.location_slug,
        abc_unit_price: rep.abc_unit_price,
        unit_cost: rep.unit_cost,
        margin_pct: Number.isFinite(price) && Number.isFinite(cost) && price > 0
          ? +(((price - cost) / price) * 100).toFixed(1)
          : (members.length === 1 ? rep.margin_pct : null),
        qty_on_hand: qty,
        sold_in_range: sold,
        _members: members,
        _consolidated: members.length > 1 || slug === 'all',
        _clubCount: members.length,
        _oversold: members.some(m => Number(m.qty_on_hand) < 0),
      }
    }
    if (slug !== 'all') return items.map(i => mk([i]))
    const byProduct = new Map()
    for (const i of items) {
      const key = i.upc ? `upc:${i.upc}` : `id:${i.id}`
      if (!byProduct.has(key)) byProduct.set(key, [])
      byProduct.get(key).push(i)
    }
    return [...byProduct.values()].map(mk)
  }, [items, slug])

  // Oversold = sold more than we had on record (qty_on_hand < 0). Someone rang
  // up a sale ABC has, but stock says we didn't have it — a count/theft flag.
  // For a consolidated row, any club going negative flags the whole product so
  // summing across clubs can't mask it.
  const oversoldCount = useMemo(() => itemRows.filter(r => r._oversold).length, [itemRows])

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    let list = itemRows.filter(r => {
      if (oversoldOnly && !r._oversold) return false
      if (category && r.category !== category) return false
      if (term && !((r.item_name || '').toLowerCase().includes(term) || (r.upc || '').includes(term))) return false
      return true
    })
    if (sort && SORT_VALUE[sort.col]) {
      const get = SORT_VALUE[sort.col]
      const dir = sort.dir === 'desc' ? -1 : 1
      list = [...list].sort((a, b) => {
        const av = get(a), bv = get(b)
        const aBad = !Number.isFinite(av), bBad = !Number.isFinite(bv)
        if (aBad && bBad) return 0
        if (aBad) return 1 // missing values always sink to the bottom
        if (bBad) return -1
        return (av - bv) * dir
      })
    }
    return list
  }, [itemRows, search, category, sort, oversoldOnly])

  // To Order tab: per-club items (never consolidated) below their category's
  // reorder point. A depleted item (on-hand <= 0) only qualifies if it sold in
  // the reorder window, so discontinued stock doesn't sit on the list forever.
  const toOrderRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const rows = orderItems.filter(it => {
      const threshold = REORDER_THRESHOLDS[it.category]
      if (threshold == null) return false
      const qty = Number(it.qty_on_hand) || 0
      if (qty >= threshold) return false
      if (qty <= 0 && !(Number(it.sold_in_range) > 0)) return false
      if (term && !((it.item_name || '').toLowerCase().includes(term) || (it.upc || '').includes(term))) return false
      return true
    })
    // Most urgent first: lowest on-hand (oversold/out on top), then by name.
    return [...rows].sort((a, b) =>
      (Number(a.qty_on_hand) || 0) - (Number(b.qty_on_hand) || 0) ||
      (a.item_name || '').localeCompare(b.item_name || ''))
  }, [orderItems, search])

  // Sales tab: same search box + clickable column sorting as the Items tab.
  const SALES_SORT_VALUE = {
    name: r => (r.name || '').toLowerCase(),
    units: r => Number(r.units),
    revenue: r => Number(r.revenue),
    cogs: r => (r.cogs == null ? null : Number(r.cogs)),
    profit: r => (r.profit == null ? null : Number(r.profit)),
    margin: r => (r.margin_pct == null ? null : Number(r.margin_pct)),
  }
  const displaySummary = useMemo(() => {
    // All-clubs view consolidates each product (same UPC) into one row: units,
    // revenue and COGS sum across clubs; COGS is only "known" if every club's
    // contribution had a cost. Matched-but-no-UPC and unmatched rows group on
    // their own so nothing collapses incorrectly.
    let base = summary
    if (slug === 'all') {
      const byProduct = new Map()
      for (const r of summary) {
        const key = r.upc ? `upc:${r.upc}` : (r.item_id ? `id:${r.item_id}` : `un:${r.name}`)
        const e = byProduct.get(key) || {
          item_id: r.item_id, name: r.name, upc: r.upc,
          units: 0, revenue: 0, cogs: 0, cogsKnown: true,
        }
        e.units += Number(r.units) || 0
        e.revenue += Number(r.revenue) || 0
        if (r.cogs == null) { if ((Number(r.units) || 0) !== 0) e.cogsKnown = false }
        else e.cogs += Number(r.cogs)
        byProduct.set(key, e)
      }
      base = [...byProduct.values()].map(e => ({
        item_id: e.item_id, name: e.name, upc: e.upc,
        units: +e.units.toFixed(2),
        revenue: +e.revenue.toFixed(2),
        cogs: e.cogsKnown ? +e.cogs.toFixed(2) : null,
        profit: e.cogsKnown ? +(e.revenue - e.cogs).toFixed(2) : null,
        margin_pct: e.cogsKnown && e.revenue > 0 ? +(((e.revenue - e.cogs) / e.revenue) * 100).toFixed(1) : null,
      }))
    }
    const term = search.trim().toLowerCase()
    let list = base.filter(r =>
      !term || (r.name || '').toLowerCase().includes(term) || (r.upc || '').includes(term)
    )
    if (salesSort && SALES_SORT_VALUE[salesSort.col]) {
      const get = SALES_SORT_VALUE[salesSort.col]
      const dir = salesSort.dir === 'desc' ? -1 : 1
      const isText = salesSort.col === 'name'
      list = [...list].sort((a, b) => {
        const av = get(a), bv = get(b)
        if (isText) return String(av).localeCompare(String(bv)) * dir
        const aBad = av == null || !Number.isFinite(av)
        const bBad = bv == null || !Number.isFinite(bv)
        if (aBad && bBad) return 0
        if (aBad) return 1 // missing values sink to the bottom regardless of dir
        if (bBad) return -1
        return (av - bv) * dir
      })
    }
    return list
  }, [summary, search, salesSort, slug])

  const lastSync = useMemo(() => {
    const rows = syncStatus?.status || []
    const ts = rows.filter(r => r.kind === 'pos' && r.last_synced_at).map(r => new Date(r.last_synced_at).getTime())
    return ts.length ? new Date(Math.max(...ts)) : null
  }, [syncStatus])

  // Restock tab: recent invoice uploads filtered to the chosen club, grouped by
  // who uploaded them (and, within a person, ordered by club then newest first).
  const restockGroups = useMemo(() => {
    const visible = invoices.filter(inv => slug === 'all' || inv.location_slug === slug)
    const byPerson = new Map()
    for (const inv of visible) {
      const key = inv.created_by_name || 'Unknown'
      if (!byPerson.has(key)) byPerson.set(key, [])
      byPerson.get(key).push(inv)
    }
    const groups = [...byPerson.entries()].map(([person, list]) => ({
      person,
      invoices: [...list].sort((a, b) =>
        (a.location_slug || '').localeCompare(b.location_slug || '') ||
        new Date(b.created_at || 0) - new Date(a.created_at || 0)),
    }))
    groups.sort((a, b) => a.person.localeCompare(b.person))
    return groups
  }, [invoices, slug])

  const onItemSaved = (updated) => setItems(list => list.map(i => i.id === updated.id ? { ...i, ...updated } : i))
  const refreshInvoices = () => getInventoryInvoices().then(res => setInvoices(res.invoices || [])).catch(() => {})

  return (
    <div className="w-full max-w-6xl mx-auto px-8 py-6">
      {/* Header card */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-text-primary">Inventory</h2>
            <span className="px-2 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red text-[10px] font-bold uppercase tracking-wider border border-wcs-red/20">Experimental</span>
            {lastSync && <span className="text-[11px] text-text-muted">POS synced {fmtDateTime(lastSync.toISOString())}</span>}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-bg rounded-lg p-1">
              {[
                { key: 'items', label: 'Inventory' },
                { key: 'order', label: 'To Order' },
                { key: 'restock', label: 'Restock' },
                { key: 'profit', label: 'Sales' },
                ...(isAdmin ? [{ key: 'audit', label: 'Audit' }] : []),
              ].map(m => (
                <button key={m.key} onClick={() => setTab(m.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === m.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <button onClick={syncNow} disabled={syncBusy} className={btnGhost}>{syncBusy ? 'Starting...' : 'Sync from ABC'}</button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-end gap-3 mt-4 flex-wrap">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Club</span>
            <select value={slug} onChange={e => setSlug(e.target.value)} className={inputCls + ' w-44'}>
              {LOCATION_OPTIONS.map(o => <option key={o.slug} value={o.slug}>{o.label}</option>)}
            </select>
          </div>
          {tab === 'profit' && (
            <>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">From</span>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">To</span>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {QUICK_RANGES.map(q => (
                  <button key={q.key}
                    onClick={() => { const r = quickRange(q.key); setFrom(r.from); setTo(r.to) }}
                    className="px-2.5 py-1 rounded-full text-[11px] font-semibold border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors">
                    {q.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {(tab === 'items' || tab === 'profit' || tab === 'order') && (
            <div className="flex-1 min-w-[200px]">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Search</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or UPC..." className={inputCls} />
            </div>
          )}
        </div>

        {/* Oversold filter — only sellable retail items are in the module, so a
            negative on-hand here means a real oversell. */}
        {tab === 'items' && oversoldCount > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setOversoldOnly(v => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${oversoldOnly ? 'bg-wcs-red text-white border-wcs-red' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              {oversoldOnly ? `Showing ${oversoldCount} oversold` : `${oversoldCount} oversold — show`}
            </button>
          </div>
        )}

        {/* Category filter chips */}
        {tab === 'items' && categories.length > 0 && (
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            <button
              onClick={() => setCategory('')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${!category ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
            >All Categories</button>
            {categories.map(c => (
              <button key={c}
                onClick={() => setCategory(cat => cat === c ? '' : c)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${category === c ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
              >{c}</button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-wcs-red mb-4 bg-surface border border-border rounded-lg px-3 py-2">{error}</p>}

      {/* === Items tab === */}
      {tab === 'items' && (
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
          {itemsLoading ? (
            <p className="text-sm text-text-muted p-6 text-center">Loading items...</p>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-text-muted mb-2">No items yet{items.length === 0 ? ' — the ABC catalog hasn’t been synced.' : ' for this filter.'}</p>
              {items.length === 0 && <button onClick={syncNow} disabled={syncBusy} className={btnPrimary}>Run first sync from ABC</button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                    <th className="py-2.5 px-4">Item</th>
                    <th className="py-2.5 px-2">Category</th>
                    <th className="py-2.5 px-2">UPC</th>
                    <SortHeader label="Price" col="price" sort={sort} onSort={cycleSort} />
                    <SortHeader label="Cost" col="cost" sort={sort} onSort={cycleSort} />
                    <SortHeader label="Margin" col="margin" sort={sort} onSort={cycleSort} />
                    <SortHeader label={slug === 'all' ? 'On Hand (all)' : 'On Hand'} col="on_hand" sort={sort} onSort={cycleSort} />
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(i => (
                    <tr key={i.id} className="border-b border-border/50 hover:bg-bg/40">
                      <td className="py-2 px-4 font-medium text-text-primary">
                        {i.item_name}
                        {i._consolidated && i._clubCount > 1 && (
                          <span className="ml-2 text-[10px] font-semibold text-text-muted">· {i._clubCount} clubs</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-text-muted">{i.category || '—'}</td>
                      <td className="py-2 px-2 text-text-muted font-mono text-xs">{i.upc || '—'}</td>
                      <td className="py-2 px-2 text-right">{fmtMoney(i.abc_unit_price)}</td>
                      <td className="py-2 px-2 text-right">{fmtMoney(i.unit_cost)}</td>
                      <td className="py-2 px-2 text-right">
                        {i.margin_pct != null
                          ? <span className={i.margin_pct < 0 ? 'text-wcs-red font-semibold' : 'text-emerald-600 font-semibold'}>{i.margin_pct}%</span>
                          : '—'}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {i._oversold ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wide text-red-700 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5">Oversold</span>
                            <span className={`font-bold ${Number(i.qty_on_hand) < 0 ? 'text-wcs-red' : 'text-text-primary'}`}>{fmtQty(i.qty_on_hand)}</span>
                          </span>
                        ) : (
                          <span className={`font-bold ${Number(i.qty_on_hand) === 0 ? 'text-text-muted' : 'text-text-primary'}`}>{fmtQty(i.qty_on_hand)}</span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-right whitespace-nowrap">
                        {!i._consolidated && (
                          <>
                            <button onClick={() => setModal({ adjust: i._members[0] })} className="text-xs font-semibold text-wcs-red hover:underline mr-3">Adjust</button>
                            <button onClick={() => setModal({ history: i._members[0] })} className="text-xs font-semibold text-text-muted hover:text-text-primary hover:underline">History</button>
                          </>
                        )}
                        {/* Cost is shared across clubs, so Edit only lives on the
                            All-clubs view (where it applies everywhere). */}
                        {isAdmin && i._consolidated && <button onClick={() => setModal({ edit: i._members[0], allClubs: true })} className="text-xs font-semibold text-text-muted hover:text-text-primary hover:underline ml-3">Edit</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* === To Order tab === */}
      {tab === 'order' && (
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-bg/40">
            <p className="text-xs text-text-muted">
              Reorder points: <span className="font-semibold text-text-primary">Drinks &amp; Snacks under 12</span>, <span className="font-semibold text-text-primary">Supplements under 4</span>. Items at 0 show only if they sold in the last {REORDER_SOLD_WINDOW_DAYS} days.
            </p>
          </div>
          {loading ? (
            <p className="text-sm text-text-muted p-6 text-center">Building order list...</p>
          ) : toOrderRows.length === 0 ? (
            <p className="text-sm text-text-muted p-8 text-center">
              {orderItems.length === 0 ? 'No items yet — sync the ABC catalog first.' : 'Nothing to order — every tracked item is above its reorder point.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                    <th className="py-2.5 px-4">Item</th>
                    {slug === 'all' && <th className="py-2.5 px-2">Club</th>}
                    <th className="py-2.5 px-2">Category</th>
                    <th className="py-2.5 px-2 text-right">On Hand</th>
                    <th className="py-2.5 px-2 text-right">Sold {REORDER_SOLD_WINDOW_DAYS}d</th>
                    <th className="py-2.5 px-2 text-right">Reorder Below</th>
                  </tr>
                </thead>
                <tbody>
                  {toOrderRows.map(i => {
                    const qty = Number(i.qty_on_hand) || 0
                    return (
                      <tr key={i.id} className="border-b border-border/50 hover:bg-bg/40">
                        <td className="py-2 px-4 font-medium text-text-primary">{i.item_name}</td>
                        {slug === 'all' && <td className="py-2 px-2 capitalize text-text-muted">{i.location_slug || '—'}</td>}
                        <td className="py-2 px-2 text-text-muted">{i.category || '—'}</td>
                        <td className="py-2 px-2 text-right">
                          {qty <= 0 ? (
                            <span className="inline-flex items-center gap-1.5 justify-end">
                              <span className="text-[9px] font-bold uppercase tracking-wide text-red-700 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5">{qty < 0 ? 'Oversold' : 'Out'}</span>
                              <span className={`font-bold ${qty < 0 ? 'text-wcs-red' : 'text-text-primary'}`}>{fmtQty(qty)}</span>
                            </span>
                          ) : (
                            <span className="font-bold text-amber-600">{fmtQty(qty)}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right text-text-muted">{fmtQty(i.sold_in_range)}</td>
                        <td className="py-2 px-2 text-right text-text-muted">{REORDER_THRESHOLDS[i.category]}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* === Sales tab === */}
      {tab === 'profit' && (
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
          {loading ? (
            <p className="text-sm text-text-muted p-6 text-center">Crunching numbers...</p>
          ) : summary.length === 0 ? (
            <p className="text-sm text-text-muted p-6 text-center">No sales in this range yet.</p>
          ) : displaySummary.length === 0 ? (
            <p className="text-sm text-text-muted p-6 text-center">No items match your search.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                  <SortHeader label="Item" col="name" sort={salesSort} onSort={cycleSalesSort} align="left" />
                  <SortHeader label="Units" col="units" sort={salesSort} onSort={cycleSalesSort} />
                  <SortHeader label="Revenue" col="revenue" sort={salesSort} onSort={cycleSalesSort} />
                  <SortHeader label="COGS" col="cogs" sort={salesSort} onSort={cycleSalesSort} />
                  <SortHeader label="Profit" col="profit" sort={salesSort} onSort={cycleSalesSort} />
                  <SortHeader label="Margin" col="margin" sort={salesSort} onSort={cycleSalesSort} />
                </tr>
              </thead>
              <tbody>
                {displaySummary.map((r, idx) => (
                  <tr key={r.item_id || idx} className="border-b border-border/50 hover:bg-bg/40">
                    <td className="py-2 px-4 font-medium text-text-primary">
                      {r.name}
                      {!r.item_id && <span className="ml-2 text-[10px] font-bold uppercase text-text-muted">(unmatched)</span>}
                    </td>
                    <td className="py-2 px-2 text-right">{fmtQty(r.units)}</td>
                    <td className="py-2 px-2 text-right">{fmtMoney(r.revenue)}</td>
                    <td className="py-2 px-2 text-right">{r.cogs != null ? fmtMoney(r.cogs) : <span className="text-text-muted text-xs">no cost data</span>}</td>
                    <td className="py-2 px-2 text-right font-semibold">{r.profit != null ? fmtMoney(r.profit) : '—'}</td>
                    <td className="py-2 px-4 text-right">
                      {r.margin_pct != null
                        ? <span className={r.margin_pct < 0 ? 'text-wcs-red font-semibold' : 'text-emerald-600 font-semibold'}>{r.margin_pct}%</span>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && summary.length > 0 && summary.some(r => r.cogs == null) && (
            <p className="text-xs text-text-muted px-4 py-3 border-t border-border">
              Items showing "no cost data" need a received invoice to establish their unit cost.
            </p>
          )}
        </div>
      )}

      {/* === Audit tab (admin) === */}
      {tab === 'audit' && isAdmin && (
        <div className="space-y-4">
          {loading && <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-6 text-center">Auditing items...</p>}
          {!loading && audit && (
            <>
              {/* Issue summary chips (click to filter) */}
              <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <p className="text-sm text-text-primary">
                    <span className="font-bold">{audit.items.length}</span> of {audit.scanned} items flagged
                    <span className="text-text-muted text-xs ml-2">(sales window: last {audit.days} days · margin threshold {audit.min_margin}%)</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setAuditIssueFilter('')}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${!auditIssueFilter ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
                  >All Issues</button>
                  {Object.entries(AUDIT_ISSUES).map(([key, meta]) => {
                    const count = audit.items.filter(i => i.issues.includes(key)).length
                    if (count === 0) return null
                    return (
                      <button key={key} title={meta.desc}
                        onClick={() => setAuditIssueFilter(f => f === key ? '' : key)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${auditIssueFilter === key ? 'bg-wcs-red text-white border-wcs-red' : meta.cls + ' hover:opacity-80'}`}
                      >{meta.label} · {count}</button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
                {audit.items.length === 0 ? (
                  <p className="text-sm text-text-muted p-8 text-center">No pricing or data issues found. Nice and clean.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                          <th className="py-2.5 px-4">Item</th>
                          {slug === 'all' && <th className="py-2.5 px-2">Club</th>}
                          <th className="py-2.5 px-2">Issues</th>
                          <th className="py-2.5 px-2 text-right">Price</th>
                          <th className="py-2.5 px-2 text-right">Cost</th>
                          <th className="py-2.5 px-2 text-right">Margin</th>
                          <th className="py-2.5 px-2 text-right">Avg Sold At</th>
                          <th className="py-2.5 px-2 text-right">Sold {audit.days}d</th>
                          <th className="py-2.5 px-2 text-right">On Hand</th>
                          <th className="py-2.5 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.items
                          .filter(i => !auditIssueFilter || i.issues.includes(auditIssueFilter))
                          .map(i => (
                            <tr key={i.id} className="border-b border-border/50 hover:bg-bg/40">
                              <td className="py-2 px-4 font-medium text-text-primary">{i.item_name}</td>
                              {slug === 'all' && <td className="py-2 px-2 capitalize text-text-muted">{i.location_slug}</td>}
                              <td className="py-2 px-2">
                                <div className="flex gap-1 flex-wrap">
                                  {i.issues.map(key => (
                                    <span key={key} title={AUDIT_ISSUES[key]?.desc}
                                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${AUDIT_ISSUES[key]?.cls || 'bg-bg text-text-muted border-border'}`}>
                                      {AUDIT_ISSUES[key]?.label || key}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="py-2 px-2 text-right">{fmtMoney(i.abc_unit_price)}</td>
                              <td className="py-2 px-2 text-right">{fmtMoney(i.unit_cost)}</td>
                              <td className="py-2 px-2 text-right">
                                {i.margin_pct != null
                                  ? <span className={i.margin_pct < 0 ? 'text-wcs-red font-semibold' : i.margin_pct < (audit.min_margin || 15) ? 'text-amber-600 font-semibold' : 'text-emerald-600 font-semibold'}>{i.margin_pct}%</span>
                                  : '—'}
                              </td>
                              <td className="py-2 px-2 text-right">{fmtMoney(i.avg_sold_price)}</td>
                              <td className="py-2 px-2 text-right">{fmtQty(i.sold_units)}</td>
                              <td className={`py-2 px-2 text-right font-bold ${Number(i.qty_on_hand) < 0 ? 'text-wcs-red' : 'text-text-primary'}`}>{fmtQty(i.qty_on_hand)}</td>
                              <td className="py-2 px-4 text-right whitespace-nowrap">
                                <button onClick={() => setModal({ history: i })} className="text-xs font-semibold text-text-muted hover:text-text-primary hover:underline">History</button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* === Restock tab === */}
      {tab === 'restock' && (
        <div className="space-y-4">
          <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm text-text-primary">
                <span className="font-bold">{restockGroups.reduce((s, g) => s + g.invoices.length, 0)}</span> recent invoice upload(s)
                {slug !== 'all' && <span className="text-text-muted text-xs ml-2">· this club</span>}
              </p>
              <p className="text-xs text-text-muted mt-0.5">Snap or upload a vendor invoice, review the matched items, and receive them into stock.</p>
            </div>
            <button onClick={() => setModal({ newInvoice: true })} className={btnPrimary}>+ New / Snap Invoice</button>
          </div>

          {loading && <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-6 text-center">Loading restocks...</p>}
          {!loading && restockGroups.length === 0 && (
            <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-8 text-center">
              No invoice uploads yet{slug !== 'all' ? ' for this club' : ''}. Tap “New / Snap Invoice” to add one.
            </p>
          )}

          {!loading && restockGroups.map(group => (
            <div key={group.person} className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-bg/50 border-b border-border flex items-center justify-between">
                <p className="text-sm font-semibold text-text-primary">{group.person}</p>
                <span className="text-xs text-text-muted">{group.invoices.length} upload(s)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/30">
                      <th className="py-2.5 px-4">Uploaded</th>
                      <th className="py-2.5 px-2">Club</th>
                      <th className="py-2.5 px-2">Vendor</th>
                      <th className="py-2.5 px-2">Pages</th>
                      <th className="py-2.5 px-2 text-right">Items</th>
                      <th className="py-2.5 px-2 text-right">Total</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.invoices.map(inv => {
                      const sum = invoiceLineSummary(inv)
                      return (
                        <tr key={inv.id} onClick={() => setModal({ invoice: inv })}
                          className="border-b border-border/50 hover:bg-bg/40 cursor-pointer">
                          <td className="py-2 px-4 whitespace-nowrap text-text-muted">{fmtDateTime(inv.created_at)}</td>
                          <td className="py-2 px-2 capitalize">{clubLabel(inv)}</td>
                          <td className="py-2 px-2 font-medium text-text-primary">
                            {inv.vendor}{inv.invoice_number ? <span className="text-text-muted font-normal"> #{inv.invoice_number}</span> : ''}
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-1 flex-wrap">
                              {(inv.files || []).length === 0 && <span className="text-xs text-text-muted">—</span>}
                              {(inv.files || []).map((f, i) => (
                                <a key={f.id} href={f.file_link} target="_blank" rel="noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="text-xs font-semibold text-wcs-red border border-wcs-red/30 bg-wcs-red/5 rounded-full px-2 py-0.5 hover:bg-wcs-red/10">
                                  {f.page_no || i + 1}
                                </a>
                              ))}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right whitespace-nowrap text-text-muted">
                            {sum.matched}/{sum.total}
                          </td>
                          <td className="py-2 px-2 text-right">{fmtMoney(inv.total)}</td>
                          <td className="py-2 px-4">
                            <span className={`text-[10px] font-bold uppercase rounded-full px-1.5 py-0.5 border ${RESTOCK_STATUS_CLS[sum.status] || RESTOCK_STATUS_CLS.Pending}`}>
                              {sum.status}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {modal?.newInvoice && (
        <InvoiceModal
          defaultSlug={slug}
          onClose={() => setModal(null)}
          onCreated={(inv) => { refreshInvoices(); setModal({ invoice: inv }) }}
        />
      )}
      {modal?.invoice && (
        <InvoiceDetail
          invoice={modal.invoice}
          onClose={() => setModal(null)}
          onChanged={refreshInvoices}
        />
      )}
      {modal?.adjust && <AdjustModal item={modal.adjust} onClose={() => setModal(null)} onSaved={onItemSaved} />}
      {modal?.edit && (
        <EditItemModal
          item={modal.edit}
          allClubs={!!modal.allClubs}
          onClose={() => setModal(null)}
          onSaved={(updated) => {
            // An all-clubs edit touched sibling rows the response doesn't carry,
            // so reload the catalog; otherwise just patch the one item in place.
            if (modal.allClubs) loadItems()
            else onItemSaved(updated)
            // Cost edits change audit results — refresh if we're on that tab.
            if (tab === 'audit') getInventoryAudit({ location_slug: slug === 'all' ? '' : slug }).then(setAudit).catch(() => {})
          }}
        />
      )}
      {modal?.history && <HistoryModal item={modal.history} onClose={() => setModal(null)} />}
    </div>
  )
}
