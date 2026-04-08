import { useState, useEffect } from 'react'
import { getTiles, createTile, updateTile, deleteTile, getLocations } from '../lib/api'

const emptyForm = {
  label: '', description: '', url: '', icon: '', parent_id: '', location_ids: [], all_locations: false, sort_order: 0, section: 'management',
}

function TileModal({ tile, tiles, locations, onClose, onSaved }) {
  const isNew = !tile
  const [form, setForm] = useState(isNew ? { ...emptyForm } : {
    label: tile.label || '',
    description: tile.description || '',
    url: tile.url || '',
    icon: tile.icon || '',
    parent_id: tile.parent_id || '',
    location_ids: (tile.locations || []).map(l => l.id),
    all_locations: (tile.locations || []).length === locations.length,
    sort_order: tile.sort_order || 0,
    section: tile.section || 'management',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const groupTiles = (tiles || []).filter(t => !t.url && !t.parent_id && t.id !== tile?.id)

  function toggleLocation(locId) {
    setForm(prev => {
      const ids = prev.location_ids.includes(locId) ? prev.location_ids.filter(id => id !== locId) : [...prev.location_ids, locId]
      return { ...prev, location_ids: ids, all_locations: ids.length === locations.length }
    })
  }

  function toggleAll(checked) {
    setForm(prev => ({ ...prev, all_locations: checked, location_ids: checked ? locations.map(l => l.id) : [] }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.location_ids.length === 0) { setError('Select at least one location'); return }
    setSaving(true)
    setError('')
    try {
      const data = {
        label: form.label, description: form.description, url: form.url, icon: form.icon,
        parent_id: form.parent_id || null, location_ids: form.location_ids,
        sort_order: form.sort_order, section: form.section,
      }
      if (isNew) await createTile(data)
      else await updateTile(tile.id, data)
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-2xl border border-border w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-text-primary">{isNew ? 'New Tile' : 'Edit Tile'}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>

        {error && <p className="text-wcs-red text-sm mb-4">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Label</label>
              <input type="text" required value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Description</label>
              <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
                placeholder="Subtitle text" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">URL (leave empty for group tile)</label>
            <input type="text" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
              placeholder="https://..." />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Icon (emoji)</label>
              <input type="text" value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red text-center"
                placeholder="📊" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Section</label>
              <select value={form.section} onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red">
                <option value="main">Main (Apps)</option>
                <option value="management">Management (Tools)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Sort Order</label>
              <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red" />
            </div>
          </div>

          {groupTiles.length > 0 && (
            <div>
              <label className="block text-xs text-text-muted mb-1">Parent Group</label>
              <select value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red">
                <option value="">None (top-level)</option>
                {groupTiles.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-text-muted mb-2">Locations</label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => toggleAll(!form.all_locations)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${form.all_locations ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
                All
              </button>
              {locations.map(loc => (
                <button key={loc.id} type="button" onClick={() => toggleLocation(loc.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${form.location_ids.includes(loc.id) ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
                  {loc.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-text-muted border border-border rounded-lg hover:text-text-primary transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
              {saving ? 'Saving...' : isNew ? 'Create' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AdminTilesTab() {
  const [tiles, setTiles] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalTile, setModalTile] = useState(undefined) // undefined=closed, null=new, object=edit

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

  async function handleDelete(id, label) {
    if (!window.confirm('Delete tile "' + label + '"?')) return
    try {
      await deleteTile(id)
      await loadData()
    } catch (e) {
      setError(e.message || 'Failed to delete tile')
    }
  }

  if (loading) return <p className="text-text-muted text-sm p-4">Loading tiles...</p>

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="flex justify-end">
        <button onClick={() => setModalTile(null)} className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity">
          + Add Tile
        </button>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Label</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Description</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Section</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Locations</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tiles.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">No tiles yet</td></tr>
            )}
            {tiles.map(t => (
              <tr key={t.id} className="border-b border-border last:border-0 hover:bg-bg transition-colors">
                <td className="px-4 py-3 text-text-primary font-medium">{t.label}</td>
                <td className="px-4 py-3 text-text-muted text-xs">{t.description || '—'}</td>
                <td className="px-4 py-3 text-text-muted text-xs capitalize">{t.section === 'main' ? 'Apps' : 'Tools'}</td>
                <td className="px-4 py-3 text-text-muted text-xs">
                  {t.locations?.length === locations.length ? 'All' : t.locations?.map(l => l.name).join(', ') || '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setModalTile(t)} className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors mr-3">Edit</button>
                  <button onClick={() => handleDelete(t.id, t.label)} className="text-xs font-medium text-wcs-red hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalTile !== undefined && (
        <TileModal tile={modalTile} tiles={tiles} locations={locations} onClose={() => setModalTile(undefined)} onSaved={() => { setModalTile(undefined); loadData() }} />
      )}
    </div>
  )
}
