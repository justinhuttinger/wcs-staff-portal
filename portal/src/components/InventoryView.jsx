import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getInventoryItems, getInventoryCategories, getInventoryItemMovements,
  adjustInventoryItem, updateInventoryItem, lookupInventoryUpc,
  getInventoryInvoices, getInventoryMovements, createInventoryInvoice, parseInventoryInvoice, addInventoryInvoiceFiles,
  deleteInventoryInvoiceFile, addInventoryInvoiceItem,
  deleteInventoryInvoiceItem, receiveInventoryInvoice, deleteInventoryInvoice,
  startInventorySync, getInventorySyncStatus, getInventoryAudit,
} from '../lib/api'
import { LOCATION_OPTIONS } from '../config/locations'
import { exportCSV } from '../lib/export'

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

const MOVEMENT_LABELS = {
  sale: 'Sale', return: 'Return', received: 'Received', adjustment: 'Stock Added', count: 'Count',
}
// Movement kinds split for the item-history Restock vs Sales filter.
const RESTOCK_KINDS = ['received', 'adjustment', 'count']
const SALES_KINDS = ['sale', 'return']

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

// Vendors we buy inventory from. "Other" covers anything one-off.
const VENDOR_OPTIONS = ['SportLife', 'Coke', 'Other']

const inputCls ='px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red w-full'
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
  const [filter, setFilter] = useState('all') // all | restock | sales
  useEffect(() => {
    getInventoryItemMovements(item.id)
      .then(res => setMovements(res.movements || []))
      .catch(err => setError(err.message))
  }, [item.id])
  const shown = (movements || []).filter(m =>
    filter === 'all' ? true
    : filter === 'restock' ? RESTOCK_KINDS.includes(m.kind)
    : SALES_KINDS.includes(m.kind))
  const personOf = (m) => m.created_by_name || m.employee_name || (m.source === 'abc_pos' ? 'ABC POS' : '—')
  return (
    <Modal title={`History — ${item.item_name}`} onClose={onClose} wide>
      <div className="flex gap-1 bg-bg rounded-lg p-1 mb-3 w-fit">
        {[{ k: 'all', label: 'All' }, { k: 'restock', label: 'Restock' }, { k: 'sales', label: 'Sales' }].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === f.k ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
            {f.label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-wcs-red">{error}</p>}
      {!movements && !error && <p className="text-sm text-text-muted">Loading...</p>}
      {movements && shown.length === 0 && <p className="text-sm text-text-muted">No {filter === 'all' ? 'sales or stock movements' : filter} yet.</p>}
      {shown.length > 0 && (
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
                <th className="py-2 pr-3">When</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Club</th>
                <th className="py-2 pr-3 text-right">Change</th><th className="py-2 pr-3 text-right">Price</th>
                <th className="py-2 pr-3 text-right">Cost</th><th className="py-2 pr-3">Person</th><th className="py-2 pr-3">Note</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(m => (
                <tr key={m.id} className="border-b border-border/50">
                  <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(m.occurred_at)}</td>
                  <td className="py-2 pr-3">{MOVEMENT_LABELS[m.kind] || m.kind}</td>
                  <td className="py-2 pr-3 capitalize text-text-muted">{m.location_slug || '—'}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${Number(m.qty_delta) < 0 ? 'text-wcs-red' : 'text-emerald-600'}`}>
                    {Number(m.qty_delta) > 0 ? '+' : ''}{fmtQty(m.qty_delta)}
                  </td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(m.unit_price)}</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(m.unit_cost)}</td>
                  <td className="py-2 pr-3 text-text-primary">{personOf(m)}</td>
                  <td className="py-2 pr-3 text-text-muted text-xs">{m.note || '—'}</td>
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

// New invoice: only Vendor + Location are asked (location shown only when the
// user can restock into more than one club — invoices are always single-club).
// The invoice # and total auto-fill from the scanned invoice / its line items.
function InvoiceModal({ onClose, onCreated, locations = [], defaultSlug }) {
  const clubs = locations.length ? locations : ['salem']
  const [vendor, setVendor] = useState('SportLife')
  const [slug, setSlug] = useState(clubs.includes(defaultSlug) ? defaultSlug : clubs[0])
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!vendor.trim()) { setError('Vendor is required'); return }
    setSaving(true); setError('')
    try {
      // No invoice #, date, total or notes — those come from the OCR read.
      const res = await createInventoryInvoice({ vendor: vendor.trim(), location_slug: slug }, files)
      let invoice = res.invoice
      if (files.length) {
        try { const p = await parseInventoryInvoice(invoice.id); invoice = p.invoice } catch (_) { /* keep manual entry */ }
      }
      // onCreated owns the next step (jump straight to the detail to review/receive)
      // — calling onClose() here would clobber that transition.
      onCreated(invoice)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal title="New Invoice" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Vendor</span>
          <select value={vendor} onChange={e => setVendor(e.target.value)} className={inputCls} autoFocus>
            {VENDOR_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        {clubs.length > 1 && (
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Location</span>
            <select value={slug} onChange={e => setSlug(e.target.value)} className={inputCls}>
              {clubs.map(s => <option key={s} value={s}>{LOCATION_OPTIONS.find(o => o.slug === s)?.label || s}</option>)}
            </select>
          </div>
        )}
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Invoice pages (PDF or photos — attach all pages)</span>
          <input type="file" accept="application/pdf,image/*" multiple capture="environment"
            onChange={e => setFiles(Array.from(e.target.files || []))} className="text-xs text-text-muted" />
          {files.length > 0 && <p className="text-[11px] text-text-muted mt-1">{files.length} page(s) selected</p>}
        </div>
        <p className="text-[11px] text-text-muted">The invoice number and total fill in automatically once the invoice is read.</p>
        {error && <p className="text-xs text-wcs-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? (files.length ? 'Reading invoice...' : 'Saving...') : 'Create Invoice'}</button>
        </div>
      </div>
    </Modal>
  )
}

// Per-line match controls for the desktop invoice review. A UPC field that a
// hardware barcode scanner can type into (it sends the digits + Enter), plus the
// name/UPC catalog search — no camera on desktop.
function LineMatcher({ line, items, onPickItem, onScanUpc }) {
  const [upc, setUpc] = useState('')
  return (
    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
      <form
        onSubmit={e => { e.preventDefault(); const c = upc.trim(); if (c) { onScanUpc(c); setUpc('') } }}
        className="flex gap-2"
      >
        <input
          value={upc} onChange={e => setUpc(e.target.value)} inputMode="numeric"
          placeholder="Scan or type UPC" className={inputCls}
        />
        <button type="submit" className={btnGhost}>Link</button>
      </form>
      <ItemPicker items={items} value={line.item_id} onChange={(id) => id && onPickItem(id)} />
    </div>
  )
}

// Invoice detail: line items + receive-into-stock. Loads its own catalog
// scoped to the invoice's club (corporate invoices search every club). Styled to
// mirror the mobile review sheet; the UPC field accepts a hardware scanner.
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
  const [receiving, setReceiving] = useState(false)
  const [result, setResult] = useState(null) // { applied, skipped } after receive

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
      // Show the new page(s) immediately from the upload response so a flaky OCR
      // re-read can't hide them.
      const added = await addInventoryInvoiceFiles(invoice.id, list)
      if (added?.invoice?.files) setFiles(added.invoice.files)
      await reparse()
    } catch (err) { setError(err.message) } finally { setParsing(false) }
  }

  async function removePage(fileId) {
    try { await deleteInventoryInvoiceFile(invoice.id, fileId); setFiles(f => f.filter(x => x.id !== fileId)) }
    catch (err) { setError(err.message) }
  }

  async function relink(line, itemId) {
    setError('')
    try {
      await deleteInventoryInvoiceItem(invoice.id, line.id)
      const res = await addInventoryInvoiceItem(invoice.id, {
        item_id: itemId, description: line.description, quantity: Number(line.quantity), unit_cost: Number(line.unit_cost),
      })
      const picked = items.find(i => i.id === itemId)
      const newItem = { ...res.item, matched_item_name: picked?.item_name || null, matched_item_upc: picked?.upc || null }
      setLines(l => l.map(x => x.id === line.id ? newItem : x)); onChanged()
    } catch (err) { setError(err.message) }
  }

  // Link a line by UPC (hardware scanner or typed). Exact single match links.
  async function relinkByUpc(line, code) {
    setError('')
    try {
      const res = await lookupInventoryUpc(String(code).trim(), { location_slug: invoice.location_slug || '' })
      const matches = res.items || []
      if (matches.length === 0) { setError(`No catalog item for UPC ${code}.`); return }
      await relink(line, matches[0].id)
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
    setReceiving(true); setError('')
    try {
      const res = await receiveInventoryInvoice(invoice.id)
      onChanged()
      setResult(res) // { applied, skipped } → shows the done screen
    } catch (err) { setError(err.message) } finally { setReceiving(false) }
  }

  const itemName = (id) => items.find(i => i.id === id)?.item_name || '—'
  const unreceived = lines.filter(l => !l.received)
  const readyCount = unreceived.filter(l => l.item_id).length
  // Total is auto-calculated from the line items (qty × unit cost), not entered.
  const linesTotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0)

  // Prominent full-modal loading while receiving — makes it obvious it's working.
  if (receiving) {
    return (
      <Modal title="Receiving…" onClose={() => {}}>
        <div className="text-center py-12">
          <div className="mx-auto w-10 h-10 border-4 border-border border-t-wcs-red rounded-full animate-spin mb-4" />
          <p className="text-sm font-semibold text-text-primary">Receiving into stock…</p>
          <p className="text-xs text-text-muted mt-1">Updating on-hand counts and item costs.</p>
        </div>
      </Modal>
    )
  }

  // Done screen with a clear close action.
  if (result) {
    return (
      <Modal title="Received" onClose={onClose}>
        <div className="text-center py-8">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-7 h-7 text-emerald-600"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          </div>
          <p className="text-lg font-bold text-text-primary">{result.applied} line(s) received into stock</p>
          {result.skipped > 0 && <p className="text-sm text-text-muted mt-1">{result.skipped} skipped (no linked catalog item)</p>}
          <button className={btnPrimary + ' mt-5'} onClick={onClose}>Close</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`${invoice.vendor}${invoice.invoice_number ? ` #${invoice.invoice_number}` : ''}`} onClose={onClose} wide>
      <div className="flex items-center gap-3 text-xs text-text-muted mb-4 flex-wrap">
        {invoice.invoice_date && <span>{invoice.invoice_date}</span>}
        {linesTotal > 0 && <span>Total: <span className="font-semibold text-text-primary">{fmtMoney(linesTotal)}</span></span>}
        {invoice.location_slug && <span className="capitalize">{invoice.location_slug}</span>}
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
          <input type="file" accept="application/pdf,image/*" multiple className="hidden"
            onChange={e => addPages(e.target.files)} />
        </label>
        <button type="button" onClick={reparse} disabled={parsing || !files.length} className={btnGhost}>
          {parsing ? 'Reading...' : 'Re-read invoice'}
        </button>
      </div>

      {/* Lines as cards (mirrors the mobile review sheet) */}
      {lines.length === 0 && !parsing && (
        <p className="text-sm text-text-muted mb-4">No line items yet. Add a page and Re-read, or add a line below.</p>
      )}
      {lines.map(l => {
        const matchedName = l.matched_item_name || (l.item_id ? itemName(l.item_id) : null)
        return (
          <div key={l.id} className="border border-border rounded-xl p-3 mb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-text-primary truncate">{matchedName || l.description || '—'}</p>
                {matchedName && (
                  <p className="text-xs text-text-muted truncate">
                    {l.matched_item_upc ? `UPC ${l.matched_item_upc}` : ''}
                    {l.description && l.description !== matchedName ? `${l.matched_item_upc ? ' · ' : ''}from “${l.description}”` : ''}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-text-primary">{fmtQty(l.quantity)} × {fmtMoney(l.unit_cost)}</p>
                <p className="text-xs text-text-muted">{fmtMoney(Number(l.quantity) * Number(l.unit_cost))}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {l.received ? (
                <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">Received</span>
              ) : (
                <>
                  {!l.item_id && <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">Not linked</span>}
                  {l.match_source && (
                    <span className={`text-[10px] font-bold uppercase rounded-full px-1.5 py-0.5 border ${
                      l.match_confidence >= 0.85 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                      : l.match_confidence >= 0.6 ? 'text-amber-700 bg-amber-50 border-amber-200'
                      : 'text-text-muted bg-bg border-border'}`}>
                      {l.match_source}{l.match_confidence != null ? ` ${Math.round(l.match_confidence * 100)}%` : ''}
                    </span>
                  )}
                  <button onClick={() => removeLine(l.id)} className="ml-auto text-xs font-semibold text-text-muted hover:text-wcs-red">Remove</button>
                </>
              )}
            </div>

            {!l.received && (
              <LineMatcher line={l} items={items} onPickItem={(id) => relink(l, id)} onScanUpc={(code) => relinkByUpc(l, code)} />
            )}
          </div>
        )
      })}

      <div className="bg-bg rounded-xl p-3 my-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Add line item manually</p>
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
        <button className={btnPrimary} onClick={receive} disabled={readyCount === 0}>
          Receive into Stock ({readyCount})
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

export default function InventoryView({ onBack, location, isAdmin, user }) {
  // Clubs this user may restock into. Admins get every club; everyone else gets
  // the locations on their staff profile. Invoices are always single-club.
  const accessibleSlugs = useMemo(() => {
    const all = LOCATION_OPTIONS.filter(o => o.slug !== 'all').map(o => o.slug)
    if (isAdmin) return all
    const mine = (user?.staff?.locations || [])
      .map(l => String(l.name || '').toLowerCase())
      .filter(s => all.includes(s))
    return mine.length ? mine : (all.includes(String(location || '').toLowerCase()) ? [String(location).toLowerCase()] : all)
  }, [isAdmin, user, location])

  const [tab, setTab] = useState('items') // items | order | restock | audit (admin)
  const [slug, setSlug] = useState('all') // default to all clubs; dropdown can narrow
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [orderItems, setOrderItems] = useState([]) // items carrying sold_in_range over the reorder window, for the To Order tab
  const [invoices, setInvoices] = useState([])
  const [movements, setMovements] = useState([])
  const [sort, setSort] = useState(null) // { col, dir: 'desc' | 'asc' } | null
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(null) // { adjust } | { history } | { newInvoice } | { invoice }
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [audit, setAudit] = useState(null) // { items, scanned, min_margin, days }
  const [auditIssueFilter, setAuditIssueFilter] = useState('all_items') // all_items | issues | <issue key>
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
    if (tab === 'audit') {
      setLoading(true)
      getInventoryAudit({ location_slug: slug === 'all' ? '' : slug, include_clean: 1 })
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
      Promise.all([getInventoryInvoices(), getInventoryMovements()])
        .then(([inv, mv]) => { setInvoices(inv.invoices || []); setMovements(mv.movements || []) })
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [tab, slug])

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
  const SORT_VALUE = {
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

  const lastSync = useMemo(() => {
    const rows = syncStatus?.status || []
    const ts = rows.filter(r => r.kind === 'pos' && r.last_synced_at).map(r => new Date(r.last_synced_at).getTime())
    return ts.length ? new Date(Math.max(...ts)) : null
  }, [syncStatus])

  // Restock tab: one date-ordered activity feed combining invoice uploads and
  // manual stock adjustments, filtered to the chosen club. Person is its own
  // column (no grouping). Each entry is normalized to a common shape.
  const restockFeed = useMemo(() => {
    const entries = []
    for (const inv of invoices) {
      if (slug !== 'all' && inv.location_slug !== slug) continue
      entries.push({ kind: 'invoice', id: `inv:${inv.id}`, at: inv.created_at,
        person: inv.created_by_name || 'Unknown', location_slug: inv.location_slug, invoice: inv })
    }
    for (const m of movements) {
      if (slug !== 'all' && m.location_slug !== slug) continue
      entries.push({ kind: 'adjustment', id: `mv:${m.id}`, at: m.occurred_at,
        person: m.created_by_name || 'Unknown', location_slug: m.location_slug, movement: m })
    }
    return entries.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
  }, [invoices, movements, slug])

  // Audit rows: on the All-clubs view, consolidate each product (same UPC) into
  // one row — union its issues, sum on-hand/sold — mirroring the Inventory tab.
  // Editing a consolidated row applies cost/UPC to every club (apply_all_clubs).
  const auditRows = useMemo(() => {
    const list = audit?.items || []
    if (slug !== 'all') return list.map(i => ({ ...i, _members: [i], _consolidated: false }))
    const byKey = new Map()
    for (const i of list) {
      const key = i.upc ? `upc:${i.upc}` : `id:${i.id}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(i)
    }
    return [...byKey.values()].map(members => {
      const rep = members[0]
      return {
        ...rep,
        issues: [...new Set(members.flatMap(m => m.issues || []))],
        qty_on_hand: members.reduce((s, m) => s + (Number(m.qty_on_hand) || 0), 0),
        sold_units: members.reduce((s, m) => s + (Number(m.sold_units) || 0), 0),
        _members: members,
        _consolidated: members.length > 1,
        _clubCount: members.length,
      }
    })
  }, [audit, slug])

  // Audit rows after the active filter tile (All Items / Issues only / a specific
  // issue). Shared by the table and the CSV export.
  const filteredAuditRows = useMemo(() => auditRows.filter(i =>
    auditIssueFilter === 'all_items' ? true
      : auditIssueFilter === 'issues' ? (i.issues?.length > 0)
        : i.issues?.includes(auditIssueFilter)
  ), [auditRows, auditIssueFilter])

  // Export the filtered audit rows, flattened to one line per club copy so each
  // carries a real item_id + cost. The blank new_cost column is meant to be
  // filled in and re-uploaded to set costs in bulk.
  function exportAudit() {
    const header = ['item_id', 'item_name', 'upc', 'category', 'club', 'price', 'current_cost', 'new_cost', 'issues']
    const rows = [header]
    for (const r of filteredAuditRows) {
      for (const m of (r._members || [r])) {
        rows.push([
          m.id, m.item_name, m.upc || '', m.category || '', m.location_slug || '',
          m.abc_unit_price ?? '', m.unit_cost ?? '', '', (m.issues || []).join('|'),
        ])
      }
    }
    const scope = auditIssueFilter === 'all_items' ? 'all' : auditIssueFilter === 'issues' ? 'issues' : auditIssueFilter
    exportCSV(rows, `inventory-audit-${scope}-${slug}-${toLocalDateStr(new Date())}`)
  }

  const onItemSaved = (updated) => setItems(list => list.map(i => i.id === updated.id ? { ...i, ...updated } : i))
  const refreshInvoices = () => {
    getInventoryInvoices().then(res => setInvoices(res.invoices || [])).catch(() => {})
    getInventoryMovements().then(res => setMovements(res.movements || [])).catch(() => {})
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-8 py-6">
      {/* Header card */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-text-primary">Inventory</h2>
            {isAdmin && lastSync && <span className="text-[11px] text-text-muted">POS synced {fmtDateTime(lastSync.toISOString())}</span>}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-bg rounded-lg p-1">
              {[
                { key: 'items', label: 'Inventory' },
                { key: 'order', label: 'To Order' },
                { key: 'restock', label: 'Restock' },
                ...(isAdmin ? [{ key: 'audit', label: 'Audit' }] : []),
              ].map(m => (
                <button key={m.key} onClick={() => setTab(m.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === m.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            {isAdmin && <button onClick={syncNow} disabled={syncBusy} className={btnGhost}>{syncBusy ? 'Starting...' : 'Sync from ABC'}</button>}
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
          {(tab === 'items' || tab === 'order') && (
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
              {items.length === 0 && isAdmin && <button onClick={syncNow} disabled={syncBusy} className={btnPrimary}>Run first sync from ABC</button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                    <th className="py-2.5 px-4">Item</th>
                    <th className="py-2.5 px-2">Category</th>
                    <th className="py-2.5 px-2">UPC</th>
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
                    <span className="font-bold">{filteredAuditRows.length}</span> {slug === 'all' ? 'products' : 'items'}
                    {auditIssueFilter === 'all_items' ? ' total' : ' shown'}
                    <span className="text-text-muted text-xs ml-2">(sales window: last {audit.days} days · margin threshold {audit.min_margin}%)</span>
                  </p>
                  <button onClick={exportAudit} disabled={filteredAuditRows.length === 0} className={btnGhost}>Export CSV</button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setAuditIssueFilter('all_items')}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${auditIssueFilter === 'all_items' ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
                  >All Items · {auditRows.length}</button>
                  <button
                    onClick={() => setAuditIssueFilter('issues')}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${auditIssueFilter === 'issues' ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
                  >All Issues · {auditRows.filter(i => i.issues?.length > 0).length}</button>
                  {Object.entries(AUDIT_ISSUES).map(([key, meta]) => {
                    const count = auditRows.filter(i => i.issues.includes(key)).length
                    if (count === 0) return null
                    return (
                      <button key={key} title={meta.desc}
                        onClick={() => setAuditIssueFilter(f => f === key ? 'all_items' : key)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${auditIssueFilter === key ? 'bg-wcs-red text-white border-wcs-red' : meta.cls + ' hover:opacity-80'}`}
                      >{meta.label} · {count}</button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
                {filteredAuditRows.length === 0 ? (
                  <p className="text-sm text-text-muted p-8 text-center">{auditIssueFilter === 'all_items' ? 'No items yet — sync the ABC catalog first.' : 'Nothing here for this filter.'}</p>
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
                        {filteredAuditRows
                          .map(i => (
                            <tr key={i.id} className="border-b border-border/50 hover:bg-bg/40">
                              <td className="py-2 px-4 font-medium text-text-primary">{i.item_name}</td>
                              {slug === 'all' && <td className="py-2 px-2 capitalize text-text-muted">{i._consolidated ? `${i._clubCount} clubs` : i.location_slug}</td>}
                              <td className="py-2 px-2">
                                <div className="flex gap-1 flex-wrap">
                                  {i.issues.length === 0 && <span className="text-[11px] text-emerald-600 font-semibold">OK</span>}
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
                                <button onClick={() => setModal({ edit: i._members[0], allClubs: i._consolidated })} className="text-xs font-semibold text-wcs-red hover:underline mr-3">Edit Cost</button>
                                <button onClick={() => setModal({ history: i._members[0] })} className="text-xs font-semibold text-text-muted hover:text-text-primary hover:underline">History</button>
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
                <span className="font-bold">{restockFeed.length}</span> recent restock {restockFeed.length === 1 ? 'entry' : 'entries'}
                {slug !== 'all' && <span className="text-text-muted text-xs ml-2">· this club</span>}
              </p>
              <p className="text-xs text-text-muted mt-0.5">Invoice uploads and manual stock adjustments, newest first. Click an invoice to review it.</p>
            </div>
            <button onClick={() => setModal({ newInvoice: true })} className={btnPrimary}>+ New / Snap Invoice</button>
          </div>

          {loading && <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-6 text-center">Loading restocks...</p>}
          {!loading && restockFeed.length === 0 && (
            <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-8 text-center">
              No restock activity yet{slug !== 'all' ? ' for this club' : ''}. Tap “New / Snap Invoice” to add one.
            </p>
          )}

          {!loading && restockFeed.length > 0 && (
            <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/30">
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-2">Person</th>
                      <th className="py-2.5 px-2">Club</th>
                      <th className="py-2.5 px-2">Type</th>
                      <th className="py-2.5 px-2">Details</th>
                      <th className="py-2.5 px-2 text-right">Amount</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restockFeed.map(entry => {
                      const clubName = entry.location_slug
                        ? (LOCATION_OPTIONS.find(o => o.slug === entry.location_slug)?.label || entry.location_slug)
                        : 'Corporate'
                      if (entry.kind === 'invoice') {
                        const inv = entry.invoice
                        const sum = invoiceLineSummary(inv)
                        const total = (inv.items || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0)
                        return (
                          <tr key={entry.id} onClick={() => setModal({ invoice: inv })}
                            className="border-b border-border/50 hover:bg-bg/40 cursor-pointer">
                            <td className="py-2 px-4 whitespace-nowrap text-text-muted">{fmtDateTime(entry.at)}</td>
                            <td className="py-2 px-2 text-text-primary">{entry.person}</td>
                            <td className="py-2 px-2 capitalize">{clubName}</td>
                            <td className="py-2 px-2"><span className="text-[10px] font-bold uppercase text-wcs-red bg-wcs-red/5 border border-wcs-red/20 rounded-full px-1.5 py-0.5">Invoice</span></td>
                            <td className="py-2 px-2 font-medium text-text-primary">
                              {inv.vendor}{inv.invoice_number ? <span className="text-text-muted font-normal"> #{inv.invoice_number}</span> : ''}
                              <span className="text-xs text-text-muted ml-2">{sum.matched}/{sum.total} items</span>
                            </td>
                            <td className="py-2 px-2 text-right whitespace-nowrap">{total > 0 ? fmtMoney(total) : '—'}</td>
                            <td className="py-2 px-4">
                              <span className={`text-[10px] font-bold uppercase rounded-full px-1.5 py-0.5 border ${RESTOCK_STATUS_CLS[sum.status] || RESTOCK_STATUS_CLS.Pending}`}>
                                {sum.status}
                              </span>
                            </td>
                          </tr>
                        )
                      }
                      const m = entry.movement
                      return (
                        <tr key={entry.id} className="border-b border-border/50">
                          <td className="py-2 px-4 whitespace-nowrap text-text-muted">{fmtDateTime(entry.at)}</td>
                          <td className="py-2 px-2 text-text-primary">{entry.person}</td>
                          <td className="py-2 px-2 capitalize">{clubName}</td>
                          <td className="py-2 px-2"><span className="text-[10px] font-bold uppercase text-text-muted bg-bg border border-border rounded-full px-1.5 py-0.5">{MOVEMENT_LABELS[m.kind] || m.kind}</span></td>
                          <td className="py-2 px-2 text-text-primary">
                            {m.item_name || '—'}
                            {m.note && <span className="text-xs text-text-muted ml-2">{m.note}</span>}
                          </td>
                          <td className={`py-2 px-2 text-right font-semibold whitespace-nowrap ${Number(m.qty_delta) < 0 ? 'text-wcs-red' : 'text-emerald-600'}`}>
                            {Number(m.qty_delta) > 0 ? '+' : ''}{fmtQty(m.qty_delta)}
                          </td>
                          <td className="py-2 px-4 text-xs text-text-muted">{m.source === 'mobile' ? 'Mobile' : 'Desktop'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {modal?.newInvoice && (
        <InvoiceModal
          locations={accessibleSlugs}
          defaultSlug={accessibleSlugs.includes(slug) ? slug : accessibleSlugs[0]}
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
            if (tab === 'audit') getInventoryAudit({ location_slug: slug === 'all' ? '' : slug, include_clean: 1 }).then(setAudit).catch(() => {})
          }}
        />
      )}
      {modal?.history && <HistoryModal item={modal.history} onClose={() => setModal(null)} />}
    </div>
  )
}
