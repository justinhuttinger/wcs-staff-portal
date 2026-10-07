import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getWorkflowMaps, getWorkflowMap, createWorkflowMap, saveWorkflowMap, duplicateWorkflowMap, deleteWorkflowMap,
} from '../../lib/api'
import { LOCATION_OPTIONS } from '../../config/locations'
import { WORKFLOW_STATUSES } from './kinds'
import { TEMPLATES, parseImport } from './templates'
import { Modal, MapDetailsForm, downloadJson } from './MapDetails'
import WorkflowEditor from './WorkflowEditor'
import { inputCls, btnPrimary, btnGhost, STATUS_CLS } from './ui'

const clubLabel = (slug) => LOCATION_OPTIONS.find(o => o.slug === slug)?.label || slug

function timeAgo(iso) {
  if (!iso) return ''
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function WorkflowMapsHome() {
  const [maps, setMaps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState('all')
  const [modal, setModal] = useState(null)       // { kind: 'new' } | { kind: 'edit', map } | { kind: 'delete', map }
  const [openId, setOpenId] = useState(null)
  const [busy, setBusy] = useState(null)
  // Only admins create, rename, duplicate, delete or import maps.
  const [canEdit, setCanEdit] = useState(false)
  const fileRef = useRef(null)

  async function load() {
    try {
      const res = await getWorkflowMaps()
      setMaps(res.maps || [])
      setCanEdit(!!res.canEdit)
      setError('')
    } catch (err) {
      setError(err.message || 'Failed to load workflow maps')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const folders = useMemo(() => [...new Set(maps.map(m => m.category).filter(Boolean))].sort(), [maps])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return maps.filter(m => (folder === 'all' || m.category === folder)
      && (!q || m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)))
  }, [maps, search, folder])

  async function create(form, templateKey) {
    const tpl = TEMPLATES.find(t => t.key === templateKey) || TEMPLATES[0]
    const { nodes, edges } = tpl.build()
    const res = await createWorkflowMap({ ...form, nodes, edges })
    setModal(null)
    setOpenId(res.map.id)
    load()
  }

  async function rename(map, form) {
    // Send the version we listed with; a 409 means someone saved since.
    await saveWorkflowMap(map.id, { ...form, version: map.version })
    setModal(null)
    load()
  }

  async function duplicate(map) {
    setBusy(map.id)
    try { await duplicateWorkflowMap(map.id); await load() } catch (err) { setError(err.message) } finally { setBusy(null) }
  }

  async function remove(map) {
    setBusy(map.id)
    try { await deleteWorkflowMap(map.id); setModal(null); await load() } catch (err) { setError(err.message) } finally { setBusy(null) }
  }

  async function exportMap(map) {
    setBusy(map.id)
    try { const res = await getWorkflowMap(map.id); downloadJson(res.map) } catch (err) { setError(err.message) } finally { setBusy(null) }
  }

  async function importFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const fields = parseImport(await file.text())
      const res = await createWorkflowMap(fields)
      setOpenId(res.map.id)
      load()
    } catch (err) {
      setError(err.message || 'Import failed')
    }
  }

  if (openId) {
    return <WorkflowEditor id={openId} onClose={() => { setOpenId(null); load() }} />
  }

  return (
    <div>
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 mb-4 flex flex-wrap items-center gap-3">
        <input className={inputCls + ' sm:max-w-xs'} placeholder="Search workflows" value={search} onChange={e => setSearch(e.target.value)} />
        {folders.length > 0 && (
          <select className={inputCls + ' sm:max-w-[180px]'} value={folder} onChange={e => setFolder(e.target.value)}>
            <option value="all">All folders</option>
            {folders.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {canEdit && (
          <div className="flex gap-2 ml-auto">
            <button className={btnGhost} onClick={() => fileRef.current?.click()}>Import JSON</button>
            <button className={btnPrimary} onClick={() => setModal({ kind: 'new' })}>+ New workflow</button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={importFile} />
          </div>
        )}
      </div>

      {error && <div className="bg-surface rounded-xl border border-border p-3 mb-4 text-sm text-wcs-red">{error}</div>}
      {loading && <p className="loading-card mx-auto block my-6">Loading workflows...</p>}

      {!loading && shown.length === 0 && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted">{maps.length === 0 ? (canEdit ? 'No workflow maps yet. Start one with + New workflow.' : 'No workflow maps yet.') : 'No workflows match that search.'}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shown.map(m => (
          <div key={m.id} className="bg-surface rounded-xl border border-border p-4 flex flex-col">
            <button onClick={() => setOpenId(m.id)} className="text-left flex-1 cursor-pointer">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-bold text-text-primary leading-tight">{m.name}</h3>
                <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${STATUS_CLS[m.status] || STATUS_CLS.draft}`}>{WORKFLOW_STATUSES[m.status] || m.status}</span>
              </div>
              {m.description && <p className="text-xs text-text-muted mt-1.5 line-clamp-2">{m.description}</p>}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {m.category && <span className="px-2 py-0.5 rounded bg-bg text-[11px] font-medium text-text-muted">{m.category}</span>}
                <span className="px-2 py-0.5 rounded bg-bg text-[11px] font-medium text-text-muted">{m.step_count} step{m.step_count === 1 ? '' : 's'}</span>
                <span className="px-2 py-0.5 rounded bg-bg text-[11px] font-medium text-text-muted">{m.clubs?.length ? m.clubs.map(clubLabel).join(', ') : 'All clubs'}</span>
              </div>
            </button>
            <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border">
              <span className="text-[11px] text-text-muted">Edited {timeAgo(m.updated_at)}{m.updated_by_name ? ' by ' + m.updated_by_name : ''}</span>
              <div className="flex gap-1">
                {canEdit && <button className="px-2 py-1 rounded text-[11px] font-semibold text-text-muted hover:text-text-primary hover:bg-bg" onClick={() => setModal({ kind: 'edit', map: m })}>Rename</button>}
                {canEdit && <button className="px-2 py-1 rounded text-[11px] font-semibold text-text-muted hover:text-text-primary hover:bg-bg disabled:opacity-50" disabled={busy === m.id} onClick={() => duplicate(m)}>Duplicate</button>}
                <button className="px-2 py-1 rounded text-[11px] font-semibold text-text-muted hover:text-text-primary hover:bg-bg disabled:opacity-50" disabled={busy === m.id} onClick={() => exportMap(m)}>Export</button>
                {canEdit && <button className="px-2 py-1 rounded text-[11px] font-semibold text-wcs-red hover:bg-wcs-red/10" onClick={() => setModal({ kind: 'delete', map: m })}>Delete</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal?.kind === 'new' && (
        <Modal title="New workflow" onClose={() => setModal(null)}>
          <MapDetailsForm showTemplates submitLabel="Create" onSubmit={create} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === 'edit' && (
        <Modal title="Workflow details" onClose={() => setModal(null)}>
          <MapDetailsForm
            initial={{ name: modal.map.name, description: modal.map.description, category: modal.map.category, status: modal.map.status, clubs: modal.map.clubs || [], ghl_workflow_url: modal.map.ghl_workflow_url }}
            submitLabel="Save" onSubmit={form => rename(modal.map, form)} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === 'delete' && (
        <Modal title="Delete workflow?" onClose={() => setModal(null)}>
          <p className="text-sm text-text-primary">Delete <strong>{modal.map.name}</strong>? This removes the map for everyone and can't be undone. Export it first if you might want it back.</p>
          <div className="flex justify-end gap-2 mt-4">
            <button className={btnGhost} onClick={() => setModal(null)}>Cancel</button>
            <button className={btnPrimary} disabled={busy === modal.map.id} onClick={() => remove(modal.map)}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
