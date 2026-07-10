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

// -----------------------------------------------------------------------------
// Lists browser — a searchable, scrolling list of the club's saved shopping
// lists. Lives inside the To Order tab (All / Lists toggle). Clicking a list
// (or "New List") hands off to the full-screen ListEditor via the callbacks.
// -----------------------------------------------------------------------------
export function ListsBrowser({ slug, refreshKey, onOpen, onCreate }) {
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const loadLists = useCallback(() => {
    if (slug === 'all') { setLists([]); setLoading(false); return }
    setLoading(true)
    getShoppingLists({ location_slug: slug })
      .then(res => setLists(res.lists || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug])

  useEffect(() => { loadLists() }, [loadLists, refreshKey])

  if (slug === 'all') {
    return (
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-text-muted">Shopping lists are per club. Pick a single club above to view and build its lists.</p>
      </div>
    )
  }

  const term = search.trim().toLowerCase()
  const shown = term ? lists.filter(l => l.name.toLowerCase().includes(term)) : lists

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
      {error && <div className="bg-red-50 border-b border-red-200 text-red-700 text-sm px-4 py-2">{error}</div>}

      <div className="px-4 py-3 border-b border-border bg-bg/40 flex items-center gap-2">
        <input
          className={inputCls}
          placeholder="Search lists..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className={btnPrimary + ' whitespace-nowrap'} onClick={onCreate}>+ New List</button>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted p-8 text-center">Loading lists...</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-text-muted p-8 text-center">
          {lists.length === 0 ? 'No lists yet. Create one with “+ New List”.' : 'No lists match your search.'}
        </p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-border/60">
          {shown.map(l => (
            <button
              key={l.id}
              onClick={() => onOpen(l.id)}
              className="w-full text-left px-4 py-3 hover:bg-bg/50 flex items-center justify-between gap-3 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{l.name}</p>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {l.item_count} item{l.item_count === 1 ? '' : 's'}
                  {l.created_by_name ? ` · ${l.created_by_name}` : ''}
                </p>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-text-muted shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// List editor — a dedicated full-screen screen (like the form builder) for
// creating or editing one list. A new list first asks for a name; once created
// it shows the item manager (search-to-add + live on-hand vs reorder level).
// -----------------------------------------------------------------------------
export function ListEditor({ slug, listId: initialId, onBack }) {
  const isNew = !initialId
  const [listId, setListId] = useState(initialId || null)
  const [name, setName] = useState('')
  const [detail, setDetail] = useState(null) // { list, items }
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  // Existing lists open read-only ("view"); Edit reveals add/remove/rename/delete.
  // A freshly created list drops straight into edit so items can be added.
  const [mode, setMode] = useState('view')

  const loadDetail = useCallback((id) => {
    setLoading(true)
    getShoppingList(id)
      .then(d => { setDetail(d); setName(d.list?.name || '') })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (listId) loadDetail(listId) }, [listId, loadDetail])

  async function handleCreate() {
    const nm = name.trim()
    if (!nm) return
    setCreating(true); setError('')
    try {
      const { list } = await createShoppingList({ location_slug: slug, name: nm })
      setListId(list.id) // triggers detail load, switches to item manager
      setMode('edit')    // new list opens ready to add items
    } catch (err) { setError(err.message) }
    setCreating(false)
  }

  async function handleRename() {
    const next = prompt('Rename list:', name)
    if (next == null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === name) return
    try {
      await renameShoppingList(listId, trimmed)
      setName(trimmed)
      setDetail(d => d ? { ...d, list: { ...d.list, name: trimmed } } : d)
    } catch (err) { setError(err.message) }
  }

  async function handleDelete() {
    if (!confirm('Delete this list? This cannot be undone.')) return
    try {
      await deleteShoppingList(listId)
      onBack()
    } catch (err) { setError(err.message) }
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-8 py-6">
      {/* Screen header */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-5">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Lists
        </button>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xl font-bold text-text-primary">
            {isNew && !listId ? 'New List' : (name || 'List')}
            <span className="ml-2 text-sm font-medium text-text-muted capitalize">· {slug}</span>
          </h2>
          {listId && (
            <div className="flex items-center gap-2">
              {mode === 'view' ? (
                <button className={btnPrimary} onClick={() => setMode('edit')}>Edit</button>
              ) : (
                <>
                  <button className={btnGhost} onClick={handleRename}>Rename</button>
                  <button className="px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors" onClick={handleDelete}>Delete</button>
                  <button className={btnPrimary} onClick={() => setMode('view')}>Done</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-wcs-red mb-4 bg-surface border border-border rounded-lg px-3 py-2">{error}</p>}

      {/* New list: name entry before item management */}
      {!listId ? (
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-6 max-w-lg">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">List name</label>
          <input
            autoFocus
            className={inputCls}
            placeholder="e.g. Weekly Drinks Order"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
          />
          <div className="flex items-center gap-2 mt-4">
            <button className={btnPrimary} onClick={handleCreate} disabled={creating || !name.trim()}>
              {creating ? 'Creating...' : 'Create list'}
            </button>
            <button className={btnGhost} onClick={onBack}>Cancel</button>
          </div>
        </div>
      ) : (
        <ItemManager slug={slug} detail={detail} loading={loading} editing={mode === 'edit'} onChanged={() => loadDetail(listId)} />
      )}
    </div>
  )
}

// Item manager: the list's item table, plus (when editing) an add-item search
// and per-row remove. Read-only in view mode.
function ItemManager({ slug, detail, loading, editing, onChanged }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const debounce = useRef(null)

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
      <div className="px-4 py-3 border-b border-border bg-bg/40">
        <p className="text-[11px] text-text-muted">
          {items.length} item{items.length === 1 ? '' : 's'}
          {belowCount > 0 && <span className="text-amber-600 font-semibold"> · {belowCount} below reorder</span>}
        </p>
      </div>

      {/* Add item (edit mode only) */}
      {editing && (
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
      )}

      {/* Items table */}
      {items.length === 0 ? (
        <p className="text-sm text-text-muted p-8 text-center">
          {editing ? 'No items yet — search above to add some.' : 'No items in this list yet. Hit Edit to add some.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                <th className="py-2.5 px-4">Item</th>
                <th className="py-2.5 px-2">Category</th>
                <th className="py-2.5 px-2 text-right">On Hand</th>
                <th className="py-2.5 px-2 text-right">Reorder At</th>
                {editing && <th className="py-2.5 px-2"></th>}
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
                  {editing && (
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
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
