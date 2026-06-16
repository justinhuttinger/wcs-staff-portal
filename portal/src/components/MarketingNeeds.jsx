import { useState, useEffect, useMemo } from 'react'
import { getMarketingNeeds, createMarketingNeed, updateMarketingNeed, deleteMarketingNeed } from '../lib/api'
import { LOCATION_OPTIONS } from '../config/locations'

const KINDS = [
  { key: 'graphic_design', label: 'Graphic Design' },
  { key: 'media', label: 'Media / Video' },
  { key: 'print', label: 'Print' },
  { key: 'social', label: 'Social' },
  { key: 'web', label: 'Web' },
  { key: 'other', label: 'Other' },
]
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.key, k.label]))
const STATUSES = [
  { key: 'open', label: 'Open', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'in_progress', label: 'In Progress', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'done', label: 'Done', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
]
const STATUS_BY = Object.fromEntries(STATUSES.map(s => [s.key, s]))
const PRIORITIES = [
  { key: 'high', label: 'High', cls: 'text-wcs-red' },
  { key: 'normal', label: 'Normal', cls: 'text-text-muted' },
  { key: 'low', label: 'Low', cls: 'text-text-muted' },
]

const inputCls = 'px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red w-full'
const btnPrimary = 'px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'
const btnGhost = 'px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text-muted hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-50'

function NeedModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', kind: 'graphic_design', priority: 'normal', due_date: '', locations: [], description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function toggleLoc(slug) {
    setForm(f => ({ ...f, locations: f.locations.includes(slug) ? f.locations.filter(l => l !== slug) : [...f.locations, slug] }))
  }
  async function save() {
    if (!form.title.trim()) { setError('Give the request a title'); return }
    setSaving(true); setError('')
    try {
      const res = await createMarketingNeed(form)
      onCreated(res.need)
      onClose()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-text-primary mb-4">New Request</h3>
        <div className="space-y-3">
          <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="What do you need? *" className={inputCls} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.kind} onChange={e => set('kind', e.target.value)} className={inputCls}>
              {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <select value={form.priority} onChange={e => set('priority', e.target.value)} className={inputCls}>
              {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label} priority</option>)}
            </select>
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Due date (optional)</span>
            <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={inputCls} />
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Clubs (optional)</span>
            <div className="flex flex-wrap gap-1.5">
              {LOCATION_OPTIONS.filter(o => o.slug !== 'all').map(o => (
                <button key={o.slug} type="button" onClick={() => toggleLoc(o.slug)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${form.locations.includes(o.slug) ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
                  {o.label}</button>
              ))}
            </div>
          </div>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="Details / specs / references" rows={3} className={inputCls} />
          {error && <p className="text-xs text-wcs-red">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className={btnGhost} onClick={onClose}>Cancel</button>
            <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Create Request'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MarketingNeeds() {
  const [needs, setNeeds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)

  function load() {
    setLoading(true)
    getMarketingNeeds()
      .then(res => setNeeds(res.needs || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function setStatus(need, status) {
    try {
      const res = await updateMarketingNeed(need.id, { status })
      setNeeds(list => list.map(n => n.id === need.id ? res.need : n))
    } catch (err) { setError(err.message) }
  }
  async function remove(need) {
    if (!confirm(`Delete "${need.title}"?`)) return
    try { await deleteMarketingNeed(need.id); setNeeds(list => list.filter(n => n.id !== need.id)) }
    catch (err) { setError(err.message) }
  }

  const visible = useMemo(() => statusFilter ? needs.filter(n => n.status === statusFilter) : needs, [needs, statusFilter])
  const counts = useMemo(() => {
    const c = { open: 0, in_progress: 0, done: 0 }
    for (const n of needs) c[n.status] = (c[n.status] || 0) + 1
    return c
  }, [needs])

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-wcs-red bg-surface border border-border rounded-lg px-3 py-2">{error}</p>}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setStatusFilter('')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${!statusFilter ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>All ({needs.length})</button>
          {STATUSES.map(s => (
            <button key={s.key} onClick={() => setStatusFilter(f => f === s.key ? '' : s.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${statusFilter === s.key ? 'bg-wcs-red text-white border-wcs-red' : s.cls + ' hover:opacity-80'}`}>
              {s.label} ({counts[s.key] || 0})</button>
          ))}
        </div>
        <button onClick={() => setShowModal(true)} className={btnPrimary}>+ New Request</button>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-sm text-text-muted p-6 text-center">Loading requests...</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-text-muted p-8 text-center">No requests{statusFilter ? ' in this status' : ' yet'}. Add one for graphic design, media, print, and more.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {visible.map(n => {
              const st = STATUS_BY[n.status] || STATUSES[0]
              const isHigh = n.priority === 'high'
              return (
                <div key={n.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text-primary">{n.title}</span>
                      {isHigh && <span className="text-[10px] font-bold uppercase text-wcs-red">High</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-text-muted flex-wrap">
                      <span className="px-1.5 py-0.5 rounded-full bg-bg border border-border font-semibold">{KIND_LABEL[n.kind] || n.kind}</span>
                      {(n.locations || []).length > 0 && <span className="capitalize">{(n.locations || []).join(', ')}</span>}
                      {n.due_date && <span>Due {n.due_date}</span>}
                      {n.requested_by_name && <span>· {n.requested_by_name}</span>}
                    </div>
                    {n.description && <p className="text-xs text-text-muted mt-1.5 whitespace-pre-wrap">{n.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select value={n.status} onChange={e => setStatus(n, e.target.value)}
                      className={`text-[11px] font-bold uppercase rounded-full px-2 py-1 border ${st.cls} cursor-pointer`}>
                      {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                    <button onClick={() => remove(n)} className="text-text-muted hover:text-wcs-red p-1" title="Delete">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showModal && <NeedModal onClose={() => setShowModal(false)} onCreated={(need) => setNeeds(list => [need, ...list])} />}
    </div>
  )
}
