import { useState, useEffect } from 'react'
import { getTiles, createTile, updateTile, deleteTile, getLocations } from '../lib/api'

const defaultForm = {
  label: '',
  description: '',
  url: '',
  icon: '',
  parent_id: '',
  location_ids: [],
  all_locations: false,
  sort_order: 0,
}

export default function AdminTilesTab() {
  const [tiles, setTiles] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(defaultForm)
  const [editForm, setEditForm] = useState({ label: '', description: '', url: '', icon: '', location_ids: [], all_locations: false, sort_order: 0 })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [tilesData, locData] = await Promise.all([getTiles(), getLocations()])
      setTiles(tilesData.tiles || [])
      setLocations(locData.locations || [])
    } catch (e) {
      setError(e.message || 'Failed to load data')
    }
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    if (form.location_ids.length === 0) {
      setError('Select at least one location')
      return
    }
    try {
      await createTile({
        label: form.label,
        description: form.description,
        url: form.url,
        icon: form.icon,
        parent_id: form.parent_id || null,
        location_ids: form.location_ids,
        sort_order: form.sort_order,
      })
      setForm(defaultForm)
      setShowAdd(false)
      await loadData()
    } catch (e) {
      setError(e.message || 'Failed to create tile')
    }
  }

  async function handleUpdate(id) {
    setError(null)
    try {
      await updateTile(id, {
        label: editForm.label,
        description: editForm.description,
        url: editForm.url,
        icon: editForm.icon,
        location_ids: editForm.location_ids,
        sort_order: editForm.sort_order,
      })
      setEditingId(null)
      await loadData()
    } catch (e) {
      setError(e.message || 'Failed to update tile')
    }
  }

  async function handleDelete(id, label) {
    if (!window.confirm('Delete tile "' + label + '"?')) return
    try {
      await deleteTile(id)
      await loadData()
    } catch (e) {
      setError(e.message || 'Failed to delete tile')
    }
  }

  function startEdit(t) {
    setEditingId(t.id)
    setEditForm({
      label: t.label,
      description: t.description || '',
      url: t.url || '',
      icon: t.icon || '',
      location_ids: (t.locations || []).map(l => l.id),
      all_locations: (t.locations || []).length === locations.length,
      sort_order: t.sort_order || 0,
    })
  }

  function LocationCheckboxes({ formState, setFormState }) {
    return (
      <div>
        <label className="flex items-center gap-1.5 text-sm text-text-primary cursor-pointer mb-1">
          <input
            type="checkbox"
            checked={formState.all_locations}
            onChange={e => setFormState(f => ({
              ...f,
              all_locations: e.target.checked,
              location_ids: e.target.checked ? locations.map(l => l.id) : []
            }))}
            className="accent-wcs-red"
          />
          <span className="font-medium text-xs">All</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {locations.map(loc => (
            <label key={loc.id} className="flex items-center gap-1 text-xs text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={formState.location_ids.includes(loc.id)}
                onChange={() => setFormState(f => {
                  const ids = f.location_ids.includes(loc.id)
                    ? f.location_ids.filter(id => id !== loc.id)
                    : [...f.location_ids, loc.id]
                  return { ...f, location_ids: ids, all_locations: ids.length === locations.length }
                })}
                className="accent-wcs-red"
              />
              {loc.name}
            </label>
          ))}
        </div>
      </div>
    )
  }

  if (loading) return <p className="text-text-muted text-sm p-4">Loading tiles...</p>

  // Group tiles (no url, used as parents)
  const groupTiles = tiles.filter(t => !t.url && !t.parent_id)

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="flex justify-end">
        <button onClick={() => setShowAdd(v => !v)}
          className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity">
          {showAdd ? 'Cancel' : '+ Add Tile'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleCreate} className="bg-surface border border-border rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-text-primary mb-2">New Tile</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Label</label>
              <input type="text" required value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="My Tool" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">URL (leave empty for group)</label>
              <input type="text" value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="https://..." />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Description</label>
              <input type="text" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="Optional" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Icon (emoji)</label>
              <input type="text" value={form.icon}
                onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="📊" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Parent Group</label>
              <select value={form.parent_id}
                onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red">
                <option value="">None (top-level)</option>
                {groupTiles.map(t => (
                  <option key={t.id} value={t.id}>{t.icon || '📁'} {t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Order</label>
              <input type="number" value={form.sort_order}
                onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="0" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-2">Locations</label>
            <LocationCheckboxes formState={form} setFormState={setForm} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => { setShowAdd(false); setForm(defaultForm) }}
              className="px-4 py-2 text-sm text-text-muted border border-border rounded-lg hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity">
              Create
            </button>
          </div>
        </form>
      )}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Icon</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted w-16">Order</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Label</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">URL</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Group</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Locations</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tiles.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-text-muted text-sm">No tiles yet</td></tr>
            )}
            {tiles.map(t => (
              <tr key={t.id} className="border-b border-border last:border-0 hover:bg-bg transition-colors">
                {editingId === t.id ? (
                  <>
                    <td className="px-4 py-3">
                      <input value={editForm.icon} onChange={e => setEditForm(f => ({ ...f, icon: e.target.value }))}
                        className="px-2 py-1 rounded border border-border bg-bg text-sm w-12 text-center" />
                    </td>
                    <td className="px-4 py-3">
                      <input type="number" value={editForm.sort_order}
                        onChange={e => setEditForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                        className="px-2 py-1 rounded border border-border bg-bg text-sm w-16 text-center" />
                    </td>
                    <td className="px-4 py-3">
                      <input value={editForm.label} onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))}
                        className="px-2 py-1 rounded border border-border bg-bg text-text-primary text-sm w-full" />
                    </td>
                    <td className="px-4 py-3">
                      <input value={editForm.url} onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))}
                        className="px-2 py-1 rounded border border-border bg-bg text-text-primary text-sm w-full" />
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {(() => { const p = tiles.find(x => x.id === t.parent_id); return p ? p.label : '—' })()}
                    </td>
                    <td className="px-4 py-3">
                      <LocationCheckboxes formState={editForm} setFormState={setEditForm} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleUpdate(t.id)} className="text-xs font-medium text-wcs-red hover:underline mr-2">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 text-xl">{t.icon || '🔗'}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{t.sort_order || 0}</td>
                    <td className="px-4 py-3 text-text-primary font-medium">{t.label}</td>
                    <td className="px-4 py-3 text-text-muted text-xs truncate max-w-48">{t.url || '(group)'}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {(() => { const p = tiles.find(x => x.id === t.parent_id); return p ? p.label : '—' })()}
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {t.locations?.length === locations.length ? 'All' : t.locations?.map(l => l.name).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => startEdit(t)} className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors mr-2">Edit</button>
                      <button onClick={() => handleDelete(t.id, t.label)} className="text-xs font-medium text-wcs-red hover:underline">Delete</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
