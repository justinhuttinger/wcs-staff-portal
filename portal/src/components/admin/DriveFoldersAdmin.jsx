import { useState, useEffect, useCallback } from 'react'
import {
  getDriveFoldersAdmin,
  createDriveFolder,
  updateDriveFolder,
  deleteDriveFolder,
  getLocations,
} from '../../lib/api'

const ROLE_OPTIONS = [
  { value: 'team_member', label: 'Team Member (everyone)' },
  { value: 'lead', label: 'Lead+' },
  { value: 'manager', label: 'Manager+' },
  { value: 'corporate', label: 'Corporate+' },
  { value: 'admin', label: 'Admin only' },
]

export default function DriveFoldersAdmin() {
  const [folders, setFolders] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    folder_id_or_url: '',
    min_role: 'team_member',
    sort_order: 0,
    is_active: true,
    location_ids: [],
  })
  const [saving, setSaving] = useState(false)

  const [loadError, setLoadError] = useState('')

  const fetchAll = useCallback(async () => {
    try {
      const [foldersRes, locsRes] = await Promise.all([
        getDriveFoldersAdmin(),
        getLocations(),
      ])
      setFolders(foldersRes.folders || [])
      setLocations(locsRes.locations || [])
      setLoadError('')
    } catch (err) {
      setLoadError(err.message || 'Failed to load')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  function openAdd() {
    setEditTarget(null)
    setForm({ name: '', description: '', folder_id_or_url: '', min_role: 'team_member', sort_order: 0, is_active: true, location_ids: [] })
    setModal('add')
  }

  function openEdit(folder) {
    setEditTarget(folder)
    setForm({
      name: folder.name,
      description: folder.description || '',
      folder_id_or_url: folder.folder_id,
      min_role: folder.min_role || 'team_member',
      sort_order: folder.sort_order || 0,
      is_active: folder.is_active !== false,
      location_ids: folder.location_ids || [],
    })
    setModal('edit')
  }

  function toggleLocation(locId) {
    setForm(f => ({
      ...f,
      location_ids: f.location_ids.includes(locId)
        ? f.location_ids.filter(id => id !== locId)
        : [...f.location_ids, locId],
    }))
  }

  async function handleSave() {
    if (!form.name.trim() || !form.folder_id_or_url.trim()) return
    setSaving(true)
    try {
      if (modal === 'edit' && editTarget) {
        await updateDriveFolder(editTarget.id, form)
      } else {
        await createDriveFolder(form)
      }
      await fetchAll()
      setModal(null)
    } catch (err) {
      alert('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(folder) {
    if (!confirm(`Delete "${folder.name}"?`)) return
    try {
      await deleteDriveFolder(folder.id)
      await fetchAll()
    } catch { /* silent */ }
  }

  const roleLabel = (r) => ROLE_OPTIONS.find(o => o.value === r)?.label || r
  const locName = (id) => locations.find(l => l.id === id)?.name || id

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">Manage Google Drive folders shown in the Shared Drive tile. Folders must be shared "Anyone with the link → Viewer."</p>
        <button onClick={openAdd} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors shrink-0">
          + Add Folder
        </button>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {loadError}. If this says "Session expired" or 401, sign out and back in.
        </div>
      )}

      {loading ? (
        <p className="text-center text-tile-sub text-sm py-8">Loading...</p>
      ) : folders.length === 0 ? (
        <div className="text-center py-8 bg-surface border border-border rounded-xl">
          <p className="text-sm text-text-muted">No drive folders configured yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {folders.map(folder => (
            <div key={folder.id} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-wcs-red/10 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-wcs-red">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-text-primary">{folder.name}</p>
                  {!folder.is_active && <span className="text-[10px] uppercase tracking-wide text-text-muted bg-bg px-1.5 py-0.5 rounded">Inactive</span>}
                </div>
                {folder.description && <p className="text-xs text-text-muted mt-0.5">{folder.description}</p>}
                <p className="text-[10px] text-text-muted mt-1">
                  {roleLabel(folder.min_role)}
                  {folder.location_ids?.length > 0 && ` • ${folder.location_ids.map(locName).join(', ')}`}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => openEdit(folder)} className="p-1.5 rounded-lg hover:bg-bg transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-text-muted">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
                  </svg>
                </button>
                <button onClick={() => handleDelete(folder)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-red-500">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-bold text-text-primary">{modal === 'edit' ? 'Edit Folder' : 'Add Folder'}</h3>
              <button onClick={() => setModal(null)} className="text-text-muted hover:text-text-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Name</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. SOPs" className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Description (optional)</label>
                <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief label shown under the tile name" className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Drive Folder URL or ID</label>
                <input type="text" value={form.folder_id_or_url} onChange={e => setForm(f => ({ ...f, folder_id_or_url: e.target.value }))} placeholder="https://drive.google.com/drive/folders/abc123..." className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
                <p className="text-[10px] text-text-muted mt-1">Paste the share URL or just the folder ID. Folder must be shared "Anyone with the link → Viewer."</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Visible to</label>
                <select value={form.min_role} onChange={e => setForm(f => ({ ...f, min_role: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red">
                  {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-1">Locations</label>
                <p className="text-[10px] text-text-muted mb-2">Leave all unchecked to make this visible at every location.</p>
                {locations.length === 0 ? (
                  <p className="text-xs text-text-muted italic">No locations loaded — check your session and refresh.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {locations.map(loc => (
                      <label key={loc.id} className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.location_ids.includes(loc.id)}
                          onChange={() => toggleLocation(loc.id)}
                        />
                        {loc.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-text-primary mb-1">Sort Order</label>
                  <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} className="w-24 px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
                </div>
                <label className="flex items-center gap-2 text-sm text-text-primary mt-5">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  Active
                </label>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setModal(null)} className="px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors">Cancel</button>
                <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.folder_id_or_url.trim()} className="px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
