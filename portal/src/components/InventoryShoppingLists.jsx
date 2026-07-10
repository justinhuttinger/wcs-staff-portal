import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getShoppingLists, createShoppingList, getShoppingList,
  renameShoppingList, deleteShoppingList, addShoppingListItem, removeShoppingListItem,
  getInventoryItems,
} from '../lib/api'

function fmtQty(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

const btnPrimary = 'px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'
const btnGhost = 'px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text-muted hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-50'
const inputCls = 'px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red w-full'

// Presaved, per-club reorder checklists. A list is a named set of catalog items;
// opening it shows each item's live on-hand next to its category's reorder level
// so staff can eyeball what to restock. Anyone with inventory access can manage
// lists. Lists are per-club, so an "all clubs" view prompts to pick one.
export default function InventoryShoppingLists({ slug }) {
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const [activeId, setActiveId] = useState(null)
  const [detail, setDetail] = useState(null) // { list, items }
  const [detailLoading, setDetailLoading] = useState(false)

  const loadLists = useCallback(() => {
    if (slug === 'all') { setLists([]); setLoading(false); return }
    setLoading(true)
    getShoppingLists({ location_slug: slug })
      .then(res => setLists(res.lists || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug])

  useEffect(() => { setActiveId(null); setDetail(null); loadLists() }, [loadLists])

  const loadDetail = useCallback((id) => {
    setDetailLoading(true)
    getShoppingList(id)
      .then(setDetail)
      .catch(err => setError(err.message))
      .finally(() => setDetailLoading(false))
  }, [])

  useEffect(() => { if (activeId) loadDetail(activeId) }, [activeId, loadDetail])

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setCreating(true); setError('')
    try {
      const { list } = await createShoppingList({ location_slug: slug, name })
      setNewName('')
      setLists(prev => [...prev, list].sort((a, b) => a.name.localeCompare(b.name)))
      setActiveId(list.id)
    } catch (err) { setError(err.message) }
    setCreating(false)
  }

  async function handleRename(id) {
    const name = prompt('Rename list:', detail?.list?.name || '')
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await renameShoppingList(id, trimmed)
      setLists(prev => prev.map(l => l.id === id ? { ...l, name: trimmed } : l).sort((a, b) => a.name.localeCompare(b.name)))
      setDetail(d => d && d.list.id === id ? { ...d, list: { ...d.list, name: trimmed } } : d)
    } catch (err) { setError(err.message) }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this list? This cannot be undone.')) return
    try {
      await deleteShoppingList(id)
      setLists(prev => prev.filter(l => l.id !== id))
      if (activeId === id) { setActiveId(null); setDetail(null) }
    } catch (err) { setError(err.message) }
  }

  if (slug === 'all') {
    return (
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-text-muted">Shopping lists are per club. Select a single club above to view and manage its lists.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">{error}</div>}

      {/* Create + list picker */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 mb-4">
          <input
            className={inputCls}
            placeholder="New list name (e.g. Weekly Drinks Order)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
          />
          <button className={btnPrimary} onClick={handleCreate} disabled={creating || !newName.trim()}>
            {creating ? 'Adding...' : 'New List'}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-text-muted">Loading...</p>
        ) : lists.length === 0 ? (
          <p className="text-sm text-text-muted">No lists yet. Create one above.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {lists.map(l => (
              <button
                key={l.id}
                onClick={() => setActiveId(l.id)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  activeId === l.id
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-bg text-text-muted border-border hover:text-text-primary hover:border-text-muted'
                }`}
              >
                {l.name} <span className="opacity-70">· {l.item_count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active list detail */}
      {activeId && (
        <ListDetail
          detail={detail}
          loading={detailLoading}
          slug={slug}
          onRename={() => handleRename(activeId)}
          onDelete={() => handleDelete(activeId)}
          onChanged={() => { loadDetail(activeId); loadLists() }}
        />
      )}
    </div>
  )
}

function ListDetail({ detail, loading, slug, onRename, onDelete, onChanged }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const debounce = useRef(null)

  // Debounced catalog search for adding items (this club only).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const term = search.trim()
    if (!term) { setResults([]); return }
    debounce.current = setTimeout(() => {
      setSearching(true)
      getInventoryItems({ location_slug: slug, q: term })
        .then(res => setResults((res.items || []).slice(0, 12)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => debounce.current && clearTimeout(debounce.current)
  }, [search, slug])

  const existingIds = new Set((detail?.items || []).map(i => i.inventory_item_id))

  async function addItem(item) {
    if (!detail) return
    setBusyId(item.id)
    try {
      await addShoppingListItem(detail.list.id, item.id)
      setSearch(''); setResults([])
      onChanged()
    } catch (err) { alert(err.message) }
    setBusyId(null)
  }

  async function removeItem(listItemId) {
    if (!detail) return
    setBusyId(listItemId)
    try {
      await removeShoppingListItem(detail.list.id, listItemId)
      onChanged()
    } catch (err) { alert(err.message) }
    setBusyId(null)
  }

  if (loading && !detail) return <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-6 text-center text-sm text-text-muted">Loading list...</div>
  if (!detail) return null

  const items = detail.items || []
  const belowCount = items.filter(i => i.below_reorder).length

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-bg/40 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-text-primary">{detail.list.name}</h3>
          <p className="text-[11px] text-text-muted mt-0.5">
            {items.length} item{items.length === 1 ? '' : 's'}
            {belowCount > 0 && <span className="text-amber-600 font-semibold"> · {belowCount} below reorder</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className={btnGhost} onClick={onRename}>Rename</button>
          <button className="px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors" onClick={onDelete}>Delete</button>
        </div>
      </div>

      {/* Add item */}
      <div className="px-4 py-3 border-b border-border relative">
        <input
          className={inputCls}
          placeholder="Add item — search catalog by name or UPC"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {(searching || results.length > 0) && (
          <div className="absolute left-4 right-4 mt-1 z-10 bg-surface border border-border rounded-lg shadow-xl max-h-72 overflow-y-auto">
            {searching && <p className="text-xs text-text-muted px-3 py-2">Searching...</p>}
            {!searching && results.length === 0 && <p className="text-xs text-text-muted px-3 py-2">No matches.</p>}
            {results.map(item => {
              const already = existingIds.has(item.id)
              return (
                <button
                  key={item.id}
                  disabled={already || busyId === item.id}
                  onClick={() => addItem(item)}
                  className="w-full text-left px-3 py-2 hover:bg-bg/60 flex items-center justify-between gap-2 disabled:opacity-50"
                >
                  <span className="text-sm text-text-primary truncate">{item.item_name}</span>
                  <span className="text-[11px] text-text-muted whitespace-nowrap">
                    {already ? 'Added' : `On hand ${fmtQty(item.qty_on_hand)}`}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Items table */}
      {items.length === 0 ? (
        <p className="text-sm text-text-muted p-8 text-center">No items yet — search above to add some.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                <th className="py-2.5 px-4">Item</th>
                <th className="py-2.5 px-2">Category</th>
                <th className="py-2.5 px-2 text-right">On Hand</th>
                <th className="py-2.5 px-2 text-right">Reorder At</th>
                <th className="py-2.5 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.list_item_id} className={`border-b border-border/50 hover:bg-bg/40 ${i.below_reorder ? 'bg-amber-50/40' : ''}`}>
                  <td className="py-2 px-4 font-medium text-text-primary">{i.item_name}</td>
                  <td className="py-2 px-2 text-text-muted">{i.category || '—'}</td>
                  <td className="py-2 px-2 text-right">
                    <span className={`font-bold ${i.below_reorder ? 'text-amber-600' : 'text-text-primary'}`}>{fmtQty(i.qty_on_hand)}</span>
                    {i.below_reorder && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-1.5 py-0.5">Low</span>}
                  </td>
                  <td className="py-2 px-2 text-right text-text-muted">{i.reorder_point != null ? fmtQty(i.reorder_point) : '—'}</td>
                  <td className="py-2 px-2 text-right">
                    <button
                      onClick={() => removeItem(i.list_item_id)}
                      disabled={busyId === i.list_item_id}
                      className="text-xs text-text-muted hover:text-red-600 disabled:opacity-50"
                      title="Remove from list"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
