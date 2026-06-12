import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getInventoryItems, getInventoryCategories, getInventoryItemMovements,
  adjustInventoryItem, getInventoryTransactions, getInventorySummary,
  getInventoryInvoices, createInventoryInvoice, addInventoryInvoiceItem,
  deleteInventoryInvoiceItem, receiveInventoryInvoice, deleteInventoryInvoice,
  startInventorySync, getInventorySyncStatus,
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
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysAgoStr(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toLocalDateStr(d)
}

const MOVEMENT_LABELS = {
  sale: 'Sale', return: 'Return', received: 'Received', adjustment: 'Adjustment', count: 'Count',
}

const inputCls = 'px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red w-full'
const btnPrimary = 'px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'
const btnGhost = 'px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text-muted hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-50'

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`bg-surface rounded-2xl border border-border shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[85vh] overflow-y-auto p-5`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// Adjust stock modal: set an exact counted quantity OR apply a +/- change.
function AdjustModal({ item, onClose, onSaved }) {
  const [mode, setMode] = useState('count') // count | delta
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const n = parseFloat(value)
    if (!Number.isFinite(n)) { setError('Enter a number'); return }
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
        {[{ key: 'count', label: 'Set exact count' }, { key: 'delta', label: 'Add / remove' }].map(m => (
          <button key={m.key} onClick={() => setMode(m.key)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === m.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
            {m.label}
          </button>
        ))}
      </div>
      <input
        type="number" step="any" autoFocus value={value} onChange={e => setValue(e.target.value)}
        placeholder={mode === 'count' ? 'Counted quantity' : 'Change (e.g. 12 or -3)'}
        className={inputCls + ' mb-3'}
      />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={inputCls + ' mb-3'} />
      {error && <p className="text-xs text-wcs-red mb-3">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
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
      {movements && movements.length === 0 && <p className="text-sm text-text-muted">No stock movements yet.</p>}
      {movements && movements.length > 0 && (
        <table className="w-full text-sm">
          <thead>
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
                <td className="py-2 pr-3 text-text-muted text-xs">{[m.created_by_name, m.note].filter(Boolean).join(' — ') || (m.source === 'abc_pos' ? 'ABC POS' : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [file, setFile] = useState(null)
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
      }, file)
      onCreated(res.invoice)
      onClose()
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
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Invoice file (PDF or photo)</span>
          <input type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} className="text-xs text-text-muted" />
        </div>
        {error && <p className="text-xs text-wcs-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Create Invoice'}</button>
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

  useEffect(() => {
    getInventoryItems({ location_slug: invoice.location_slug || '' })
      .then(res => setItems(res.items || []))
      .catch(() => {})
  }, [invoice.id, invoice.location_slug])
  const [desc, setDesc] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [linkedItem, setLinkedItem] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
                  <span className="font-medium text-text-primary">{l.item_id ? itemName(l.item_id) : (l.description || '—')}</span>
                  {l.item_id && l.description && <span className="text-xs text-text-muted ml-2">{l.description}</span>}
                  {!l.item_id && <span className="ml-2 text-[10px] font-bold uppercase text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">Not linked</span>}
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

export default function InventoryView({ onBack, location }) {
  const defaultSlug = (location || '').toLowerCase()
  const validDefault = LOCATION_OPTIONS.some(o => o.slug === defaultSlug) ? defaultSlug : 'all'

  const [tab, setTab] = useState('items') // items | sales | invoices | profit
  const [slug, setSlug] = useState(validDefault)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [transactions, setTransactions] = useState([])
  const [invoices, setInvoices] = useState([])
  const [summary, setSummary] = useState([])
  const [from, setFrom] = useState(daysAgoStr(30))
  const [to, setTo] = useState(toLocalDateStr(new Date()))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(null) // { adjust } | { history } | { newInvoice } | { invoice }
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncBusy, setSyncBusy] = useState(false)

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
    if (tab === 'sales') {
      setLoading(true)
      getInventoryTransactions({ location_slug: slug === 'all' ? '' : slug, from, to })
        .then(res => setTransactions(res.transactions || []))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    } else if (tab === 'invoices') {
      setLoading(true)
      getInventoryInvoices()
        .then(res => setInvoices(res.invoices || []))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    } else if (tab === 'profit') {
      setLoading(true)
      getInventorySummary({ location_slug: slug === 'all' ? '' : slug, from, to })
        .then(res => setSummary(res.summary || []))
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

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter(i => {
      if (category && i.category !== category) return false
      if (term && !((i.item_name || '').toLowerCase().includes(term) || (i.upc || '').includes(term))) return false
      return true
    })
  }, [items, search, category])

  const lastSync = useMemo(() => {
    const rows = syncStatus?.status || []
    const ts = rows.filter(r => r.kind === 'pos' && r.last_synced_at).map(r => new Date(r.last_synced_at).getTime())
    return ts.length ? new Date(Math.max(...ts)) : null
  }, [syncStatus])

  const onItemSaved = (updated) => setItems(list => list.map(i => i.id === updated.id ? updated : i))
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
              {[{ key: 'items', label: 'Items' }, { key: 'sales', label: 'Sales' }, { key: 'invoices', label: 'Invoices' }, { key: 'profit', label: 'Profit' }].map(m => (
                <button key={m.key} onClick={() => setTab(m.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === m.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <button onClick={syncNow} disabled={syncBusy} className={btnGhost}>{syncBusy ? 'Starting...' : 'Sync from ABC'}</button>
            {tab === 'invoices' && (
              <button onClick={() => setModal({ newInvoice: true })} className={btnPrimary}>+ New Invoice</button>
            )}
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
          {tab === 'items' && (
            <>
              <div className="flex-1 min-w-[200px]">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Search</span>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or UPC..." className={inputCls} />
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Category</span>
                <select value={category} onChange={e => setCategory(e.target.value)} className={inputCls + ' w-44'}>
                  <option value="">All Categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </>
          )}
          {(tab === 'sales' || tab === 'profit') && (
            <>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">From</span>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">To</span>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
              </div>
            </>
          )}
        </div>
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
                    {slug === 'all' && <th className="py-2.5 px-2">Club</th>}
                    <th className="py-2.5 px-2">Category</th>
                    <th className="py-2.5 px-2">UPC</th>
                    <th className="py-2.5 px-2 text-right">Price</th>
                    <th className="py-2.5 px-2 text-right">Cost</th>
                    <th className="py-2.5 px-2 text-right">Margin</th>
                    <th className="py-2.5 px-2 text-right">On Hand</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(i => (
                    <tr key={i.id} className="border-b border-border/50 hover:bg-bg/40">
                      <td className="py-2 px-4 font-medium text-text-primary">{i.item_name}</td>
                      {slug === 'all' && <td className="py-2 px-2 capitalize text-text-muted">{i.location_slug}</td>}
                      <td className="py-2 px-2 text-text-muted">{i.category || '—'}</td>
                      <td className="py-2 px-2 text-text-muted font-mono text-xs">{i.upc || '—'}</td>
                      <td className="py-2 px-2 text-right">{fmtMoney(i.abc_unit_price)}</td>
                      <td className="py-2 px-2 text-right">{fmtMoney(i.unit_cost)}</td>
                      <td className="py-2 px-2 text-right">
                        {i.margin_pct != null
                          ? <span className={i.margin_pct < 0 ? 'text-wcs-red font-semibold' : 'text-emerald-600 font-semibold'}>{i.margin_pct}%</span>
                          : '—'}
                      </td>
                      <td className={`py-2 px-2 text-right font-bold ${Number(i.qty_on_hand) <= 0 ? 'text-wcs-red' : 'text-text-primary'}`}>{fmtQty(i.qty_on_hand)}</td>
                      <td className="py-2 px-4 text-right whitespace-nowrap">
                        <button onClick={() => setModal({ adjust: i })} className="text-xs font-semibold text-wcs-red hover:underline mr-3">Adjust</button>
                        <button onClick={() => setModal({ history: i })} className="text-xs font-semibold text-text-muted hover:text-text-primary hover:underline">History</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* === Sales tab === */}
      {tab === 'sales' && (
        <div className="space-y-3">
          {loading && <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-6 text-center">Loading sales...</p>}
          {!loading && transactions.length === 0 && (
            <p className="text-sm text-text-muted bg-surface rounded-xl border border-border p-6 text-center">No POS transactions synced for this range yet.</p>
          )}
          {!loading && transactions.map(t => (
            <div key={t.id} className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-text-primary text-sm">{fmtDateTime(t.transaction_at)}</span>
                  <span className="text-xs text-text-muted capitalize">{t.location_slug}</span>
                  {t.receipt_number && <span className="text-xs text-text-muted">Receipt #{t.receipt_number}</span>}
                  {t.station_name && <span className="text-xs text-text-muted">{t.station_name}</span>}
                  {t.is_return && <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold uppercase border border-amber-200">Return</span>}
                </div>
                <span className="font-bold text-text-primary text-sm">
                  {fmtMoney((t.items || []).reduce((s, li) => s + (Number(li.subtotal) || 0), 0))}
                </span>
              </div>
              <div className="space-y-1">
                {(t.items || []).map(li => (
                  <div key={li.id} className="flex items-center justify-between text-sm">
                    <span className="text-text-primary">
                      {fmtQty(li.quantity)}× {li.name || 'Unknown item'}
                      {!li.item_id && <span className="ml-2 text-[10px] font-bold uppercase text-text-muted">(not in catalog)</span>}
                    </span>
                    <span className="text-text-muted">{fmtMoney(li.unit_price)} ea · {fmtMoney(li.subtotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* === Invoices tab === */}
      {tab === 'invoices' && (
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
          {loading ? (
            <p className="text-sm text-text-muted p-6 text-center">Loading invoices...</p>
          ) : invoices.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-text-muted mb-3">No invoices yet. Upload vendor invoices to record what you paid for goods — that's where cost and profit numbers come from.</p>
              <button onClick={() => setModal({ newInvoice: true })} className={btnPrimary}>+ New Invoice</button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                  <th className="py-2.5 px-4">Vendor</th><th className="py-2.5 px-2">Invoice #</th><th className="py-2.5 px-2">Date</th>
                  <th className="py-2.5 px-2">Club</th><th className="py-2.5 px-2 text-right">Total</th><th className="py-2.5 px-2 text-right">Lines</th>
                  <th className="py-2.5 px-2">Status</th><th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const received = (inv.items || []).filter(l => l.received).length
                  return (
                    <tr key={inv.id} className="border-b border-border/50 hover:bg-bg/40 cursor-pointer" onClick={() => setModal({ invoice: inv })}>
                      <td className="py-2 px-4 font-medium text-text-primary">{inv.vendor}</td>
                      <td className="py-2 px-2 text-text-muted">{inv.invoice_number || '—'}</td>
                      <td className="py-2 px-2 text-text-muted">{inv.invoice_date || '—'}</td>
                      <td className="py-2 px-2 capitalize text-text-muted">{inv.location_slug || 'Corporate'}</td>
                      <td className="py-2 px-2 text-right">{fmtMoney(inv.total)}</td>
                      <td className="py-2 px-2 text-right">{(inv.items || []).length}</td>
                      <td className="py-2 px-2">
                        {received === (inv.items || []).length && received > 0
                          ? <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">Received</span>
                          : received > 0
                            ? <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">Partial</span>
                            : <span className="text-[10px] font-bold uppercase text-text-muted bg-bg border border-border rounded-full px-1.5 py-0.5">Open</span>}
                      </td>
                      <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                        {inv.file_link && <a href={inv.file_link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-text-muted hover:text-text-primary hover:underline mr-3">File</a>}
                        {received === 0 && (
                          <button
                            onClick={() => { if (confirm('Delete this invoice?')) deleteInventoryInvoice(inv.id).then(refreshInvoices).catch(err => setError(err.message)) }}
                            className="text-xs font-semibold text-wcs-red hover:underline">Delete</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* === Profit tab === */}
      {tab === 'profit' && (
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
          {loading ? (
            <p className="text-sm text-text-muted p-6 text-center">Crunching numbers...</p>
          ) : summary.length === 0 ? (
            <p className="text-sm text-text-muted p-6 text-center">No sales in this range yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                  <th className="py-2.5 px-4">Item</th>
                  {slug === 'all' && <th className="py-2.5 px-2">Club</th>}
                  <th className="py-2.5 px-2 text-right">Units</th>
                  <th className="py-2.5 px-2 text-right">Revenue</th>
                  <th className="py-2.5 px-2 text-right">COGS</th>
                  <th className="py-2.5 px-2 text-right">Profit</th>
                  <th className="py-2.5 px-4 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r, idx) => (
                  <tr key={r.item_id || idx} className="border-b border-border/50 hover:bg-bg/40">
                    <td className="py-2 px-4 font-medium text-text-primary">
                      {r.name}
                      {!r.item_id && <span className="ml-2 text-[10px] font-bold uppercase text-text-muted">(unmatched)</span>}
                    </td>
                    {slug === 'all' && <td className="py-2 px-2 capitalize text-text-muted">{r.location_slug}</td>}
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

      {/* Modals */}
      {modal?.adjust && <AdjustModal item={modal.adjust} onClose={() => setModal(null)} onSaved={onItemSaved} />}
      {modal?.history && <HistoryModal item={modal.history} onClose={() => setModal(null)} />}
      {modal?.newInvoice && (
        <InvoiceModal
          defaultSlug={slug}
          onClose={() => setModal(null)}
          onCreated={(inv) => { refreshInvoices(); setModal({ invoice: { ...inv, items: [] } }) }}
        />
      )}
      {modal?.invoice && (
        <InvoiceDetail
          invoice={modal.invoice}
          onClose={() => { setModal(null); loadItems() }}
          onChanged={refreshInvoices}
        />
      )}
    </div>
  )
}
