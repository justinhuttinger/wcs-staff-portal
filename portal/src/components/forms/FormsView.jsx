import { useEffect, useState } from 'react'
import { forms as formsApi } from '../../lib/api'
import FormBuilder from './FormBuilder'

const STATUS_STYLES = {
  draft: 'bg-gray-100 border border-gray-200 text-gray-600',
  published: 'bg-green-50 border border-green-200 text-green-700',
  archived: 'bg-amber-50 border border-amber-200 text-amber-700',
}

export default function FormsView({ onBack, me }) {
  const [items, setItems] = useState(null)
  const [driveFolderId, setDriveFolderId] = useState(null)
  const [error, setError] = useState('')
  const [openFormId, setOpenFormId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [tab, setTab] = useState('forms')
  const [search, setSearch] = useState('')
  const [locFilter, setLocFilter] = useState('')

  async function load() {
    try {
      const res = await formsApi.list()
      setItems(res.forms || [])
      setDriveFolderId(res.drive_folder_id || null)
    } catch (err) { setError(err.message) }
  }
  useEffect(() => { load() }, [])

  if (openFormId) {
    return <FormBuilder formId={openFormId} me={me} onBack={() => { setOpenFormId(null); load() }} />
  }

  // Filter options come from the forms themselves, so the dropdown only ever
  // lists locations that actually have forms.
  const locations = [...new Map((items || []).map(f => [f.location_id, f.location_name])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const query = search.trim().toLowerCase()
  const filtered = (items || []).filter(f =>
    (!query || (f.title || '').toLowerCase().includes(query)) &&
    (!locFilter || f.location_id === locFilter)
  )
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4 w-full">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Forms</h2>
            <p className="text-xs text-text-muted">Build signup forms, share them with a QR code, and collect responses in Google Sheets</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity shrink-0"
          >New Form</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {[['forms', 'Forms'], ['submissions', 'Submissions']].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${tab === key
                  ? 'bg-wcs-red text-white'
                  : 'bg-bg text-text-muted hover:text-text-primary'}`}
              >{label}</button>
            ))}
          </div>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name..."
            className="flex-1 min-w-[160px] px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
          <select value={locFilter} onChange={e => setLocFilter(e.target.value)}
            className="px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red">
            <option value="">All locations</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error}</div>}
      {items === null ? (
        <div className="loading-card" />
      ) : items.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center text-sm text-text-muted">
          No forms yet. Create your first one.
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center text-sm text-text-muted">
          No forms match your search or filter.
        </div>
      ) : tab === 'forms' ? (
        <div className="bg-surface rounded-xl border border-border divide-y divide-border">
          {filtered.map(f => (
            <button key={f.id} onClick={() => setOpenFormId(f.id)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-bg transition-colors">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text-primary truncate">{f.title}</div>
                <div className="text-xs text-text-muted">{f.owner_name} · {f.location_name}</div>
              </div>
              <div className="text-xs text-text-muted">{f.submission_count} submissions</div>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${STATUS_STYLES[f.status]}`}>
                {f.status.charAt(0).toUpperCase() + f.status.slice(1)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          {driveFolderId && (
            <div className="bg-surface rounded-xl border border-border px-5 py-4 flex items-center justify-between gap-3">
              <div className="text-sm text-text-muted">Every response sheet lives in one shared Google Drive folder.</div>
              <a href={`https://drive.google.com/drive/folders/${driveFolderId}`} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity shrink-0"
              >Open Drive Folder</a>
            </div>
          )}
          <div className="bg-surface rounded-xl border border-border divide-y divide-border">
            {filtered.map(f => (
              <div key={f.id} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-primary truncate">{f.title}</div>
                  <div className="text-xs text-text-muted">{f.location_name} · {f.submission_count} submissions</div>
                </div>
                {f.sheet_id ? (
                  <a href={`https://docs.google.com/spreadsheets/d/${f.sheet_id}`} target="_blank" rel="noopener noreferrer"
                    className="text-sm font-medium text-wcs-red hover:underline shrink-0"
                  >Open Sheet ↗</a>
                ) : (
                  <span className="text-xs text-text-muted shrink-0">No sheet yet — publish to create one</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {showCreate && (
        <CreateFormModal me={me} onClose={() => setShowCreate(false)}
          onCreated={(form) => { setShowCreate(false); setOpenFormId(form.id) }} />
      )}
    </div>
  )
}

function CreateFormModal({ me, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [locationId, setLocationId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const locations = me?.locations || []
  const needsPicker = locations.length > 1
  useEffect(() => { if (locations.length === 1) setLocationId(locations[0].id) }, [locations])

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true); setError('')
    try {
      const body = { title, description }
      if (locationId) body.location_id = locationId
      const res = await formsApi.create(body)
      onCreated(res.form)
    } catch (err) { setError(err.message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-border w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-text-primary">New Form</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm mb-4">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Summer Bash Signup"
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">Intro text (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red" />
          </div>
          {needsPicker && (
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-1">Location</label>
              <select value={locationId} onChange={e => setLocationId(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red">
                <option value="">Choose a location</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted border border-border rounded-lg hover:text-text-primary transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
            {saving ? 'Creating...' : 'Create Form'}
          </button>
        </div>
      </div>
    </div>
  )
}
