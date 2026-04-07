import { useState, useEffect } from 'react'
import { getTiles, createTile, updateTile, deleteTile, getLocations } from '../lib/api'

const defaultForm = {
  label: '',
  description: '',
  url: '',
  icon: '',
  location_id: '',
}

const defaultEditForm = {
  label: '',
  description: '',
  url: '',
  icon: '',
}

const LINK_EMOJI = '\uD83D\uDD17'

export default function AdminTilesTab() {
  const [tiles, setTiles] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(defaultForm)
  const [editForm, setEditForm] = useState(defaultEditForm)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [tilesData, locData] = await Promise.all([getTiles(), getLocations()])
      setTiles(tilesData)
      setLocations(locData)
    } catch (e) {
      setError(e.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    try {
      await createTile(form)
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
      await updateTile(id, editForm)
      setEditingId(null)
      setEditForm(defaultEditForm)
      await loadData()
    } catch (e) {
      setError(e.message || 'Failed to update tile')
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Are you sure you want to delete this tile?')) return
    setError(null)
    try {
      await deleteTile(id)
      await loadData()
    } catch (e) {
      setError(e.message || 'Failed to delete tile')
    }
  }

  function startEdit(tile) {
    setEditingId(tile.id)
    setEditForm({
      label: tile.label || '',
      description: tile.description || '',
      url: tile.url || '',
      icon: tile.icon || '',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-text-muted text-sm">Loading tiles...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Add Tile Button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowAdd(v => !v)}
          className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          {showAdd ? 'Cancel' : '+ Add Tile'}
        </button>
      </div>

      {/* Add Tile Form */}
      {showAdd && (
        <form
          onSubmit={handleCreate}
          className="bg-surface border border-border rounded-xl p-6 space-y-4"
        >
          <h3 className="text-sm font-semibold text-text-primary mb-2">New Tile</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Label</label>
              <input
                type="text"
                required
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="My Tool"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">URL</label>
              <input
                type="url"
                required
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="https://example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="Short description"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Icon (emoji)</label>
              <input
                type="text"
                value={form.icon}
                onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                placeholder="🔧"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-text-muted mb-1">Location</label>
              <select
                value={form.location_id}
                onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red"
              >
                <option value="">All Locations</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { setShowAdd(false); setForm(defaultForm) }}
              className="px-4 py-2 text-sm text-text-muted border border-border rounded-lg hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Create
            </button>
          </div>
        </form>
      )}

      {/* Tiles Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted w-12">Icon</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Label</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">URL</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted">Location</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tiles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-muted text-sm">
                  No tiles found.
                </td>
              </tr>
            )}
            {tiles.map(tile => (
              <tr key={tile.id} className="border-b border-border last:border-0 hover:bg-bg transition-colors">
                {editingId === tile.id ? (
                  <>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={editForm.icon}
                        onChange={e => setEditForm(f => ({ ...f, icon: e.target.value }))}
                        className="w-12 px-2 py-1 bg-bg border border-border rounded text-sm text-center focus:outline-none focus:border-wcs-red"
                        placeholder="🔧"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={editForm.label}
                        onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))}
                        className="w-full px-2 py-1 bg-bg border border-border rounded text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="url"
                        value={editForm.url}
                        onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))}
                        className="w-full px-2 py-1 bg-bg border border-border rounded text-sm text-text-primary focus:outline-none focus:border-wcs-red"
                      />
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {tile.locations?.name || 'All'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleUpdate(tile.id)}
                          className="text-xs font-medium text-wcs-red hover:underline"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditForm(defaultEditForm) }}
                          className="text-xs text-text-muted hover:text-text-primary"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 text-lg text-center">
                      {tile.icon || LINK_EMOJI}
                    </td>
                    <td className="px-4 py-3 text-text-primary font-medium">
                      {tile.label || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={tile.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-wcs-red hover:underline text-xs truncate max-w-[200px] block"
                      >
                        {tile.url}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {tile.locations?.name || 'All'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => startEdit(tile)}
                          className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(tile.id)}
                          className="text-xs font-medium text-wcs-red hover:underline"
                        >
                          Delete
                        </button>
                      </div>
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
