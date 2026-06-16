import { useState, useEffect, useMemo } from 'react'
import {
  getMarketingNeeds, createMarketingNeed, updateMarketingNeed, deleteMarketingNeed,
  getMarketingNeedComments, addMarketingNeedComment,
} from '../lib/api'
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
  { key: 'high', label: 'High' },
  { key: 'normal', label: 'Normal' },
  { key: 'low', label: 'Low' },
]
const FIELD_LABEL = {
  title: 'Title', kind: 'Type', status: 'Status', priority: 'Priority',
  due_date: 'Due date', assignee_name: 'Assignee', description: 'Details', locations: 'Clubs',
}

const inputCls = 'px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red w-full'
const btnPrimary = 'px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'
const btnGhost = 'px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text-muted hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-50'

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const clubLabel = (slug) => LOCATION_OPTIONS.find(o => o.slug === slug)?.label || slug

function ClubChips({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {LOCATION_OPTIONS.filter(o => o.slug !== 'all').map(o => (
        <button key={o.slug} type="button"
          onClick={() => onChange(value.includes(o.slug) ? value.filter(l => l !== o.slug) : [...value, o.slug])}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${value.includes(o.slug) ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
          {o.label}</button>
      ))}
    </div>
  )
}

function NeedModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', kind: 'graphic_design', priority: 'normal', due_date: '', locations: [], description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  async function save() {
    if (!form.title.trim()) { setError('Give the request a title'); return }
    setSaving(true); setError('')
    try { onCreated((await createMarketingNeed(form)).need); onClose() }
    catch (err) { setError(err.message) } finally { setSaving(false) }
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
            <ClubChips value={form.locations} onChange={v => set('locations', v)} />
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

// Detail + edit + comments + edit history. Delete lives here only.
function NeedDetailModal({ need, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState({
    title: need.title, kind: need.kind, priority: need.priority, status: need.status,
    due_date: need.due_date || '', locations: need.locations || [], description: need.description || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activity, setActivity] = useState(null)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function loadActivity() {
    getMarketingNeedComments(need.id).then(r => setActivity(r.comments || [])).catch(() => setActivity([]))
  }
  useEffect(() => { loadActivity() }, [need.id])

  const dirty = useMemo(() => (
    form.title !== need.title || form.kind !== need.kind || form.priority !== need.priority ||
    form.status !== need.status || (form.due_date || '') !== (need.due_date || '') ||
    (form.description || '') !== (need.description || '') ||
    [...form.locations].sort().join('|') !== [...(need.locations || [])].sort().join('|')
  ), [form, need])

  async function save() {
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true); setError('')
    try {
      const res = await updateMarketingNeed(need.id, form)
      onSaved(res.need)
      loadActivity()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  async function postComment() {
    if (!comment.trim()) return
    setPosting(true)
    try { await addMarketingNeedComment(need.id, comment.trim()); setComment(''); loadActivity() }
    catch (err) { setError(err.message) } finally { setPosting(false) }
  }
  async function remove() {
    if (!confirm(`Delete "${need.title}"? This can't be undone.`)) return
    try { await deleteMarketingNeed(need.id); onDeleted() } catch (err) { setError(err.message) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-2xl p-5 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-lg font-bold text-text-primary">Request</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="text-[11px] text-text-muted mb-4">Requested {fmtDate(need.created_at)}{need.requested_by_name ? ` by ${need.requested_by_name}` : ''}</p>

        <div className="space-y-3">
          <input value={form.title} onChange={e => set('title', e.target.value)} className={inputCls + ' font-semibold'} />
          <div className="grid grid-cols-3 gap-3">
            <select value={form.kind} onChange={e => set('kind', e.target.value)} className={inputCls}>
              {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <select value={form.priority} onChange={e => set('priority', e.target.value)} className={inputCls}>
              {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label} priority</option>)}
            </select>
            <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
              {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Due date</span>
            <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={inputCls + ' w-48'} />
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Clubs</span>
            <ClubChips value={form.locations} onChange={v => set('locations', v)} />
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Details</span>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} className={inputCls} placeholder="Specs / references / notes" />
          </div>
          {error && <p className="text-xs text-wcs-red">{error}</p>}
          <div className="flex items-center justify-between">
            <button onClick={remove} className="text-xs font-semibold text-wcs-red hover:underline">Delete request</button>
            <button onClick={save} disabled={saving || !dirty} className={btnPrimary}>{saving ? 'Saving...' : 'Save changes'}</button>
          </div>
        </div>

        {/* Activity feed */}
        <div className="mt-6 border-t border-border pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-3">Activity</p>
          <div className="flex gap-2 mb-4">
            <input value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') postComment() }}
              placeholder="Add a comment…" className={inputCls} />
            <button onClick={postComment} disabled={posting || !comment.trim()} className={btnPrimary}>Post</button>
          </div>
          {activity === null ? (
            <p className="text-xs text-text-muted">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="text-xs text-text-muted">No activity yet.</p>
          ) : (
            <div className="space-y-3">
              {[...activity].reverse().map(a => (
                <div key={a.id} className="text-sm">
                  {a.kind === 'edit' ? (
                    <p className="text-xs text-text-muted">
                      <span className="font-semibold text-text-primary">{a.created_by_name || 'Someone'}</span>{' '}
                      {(a.meta?.changes || []).map(c => `${c.action} ${FIELD_LABEL[c.field] || c.field}`).join(', ') || 'made an edit'}
                      <span className="ml-2 text-text-muted/70">{fmtDateTime(a.created_at)}</span>
                    </p>
                  ) : (
                    <div>
                      <p className="text-text-primary whitespace-pre-wrap">{a.body}</p>
                      <p className="text-[11px] text-text-muted mt-0.5">{a.created_by_name || 'Someone'} · {fmtDateTime(a.created_at)}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
  const [detail, setDetail] = useState(null)

  function load() {
    setLoading(true)
    getMarketingNeeds().then(res => setNeeds(res.needs || [])).catch(err => setError(err.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

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
              return (
                <button key={n.id} onClick={() => setDetail(n)}
                  className="w-full text-left p-4 flex items-start justify-between gap-4 hover:bg-bg/40 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text-primary">{n.title}</span>
                      {n.priority === 'high' && <span className="text-[10px] font-bold uppercase text-wcs-red">High</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-text-muted flex-wrap">
                      <span className="px-1.5 py-0.5 rounded-full bg-bg border border-border font-semibold">{KIND_LABEL[n.kind] || n.kind}</span>
                      {(n.locations || []).length > 0 && <span>{(n.locations || []).map(clubLabel).join(', ')}</span>}
                      {n.due_date && <span>Due {n.due_date}</span>}
                      <span>Requested {fmtDate(n.created_at)}{n.requested_by_name ? ` · ${n.requested_by_name}` : ''}</span>
                    </div>
                    {n.description && <p className="text-xs text-text-muted mt-1.5 line-clamp-2 whitespace-pre-wrap">{n.description}</p>}
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold uppercase rounded-full px-2 py-1 border ${st.cls}`}>{st.label}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showModal && <NeedModal onClose={() => setShowModal(false)} onCreated={(need) => setNeeds(list => [need, ...list])} />}
      {detail && (
        <NeedDetailModal
          need={detail}
          onClose={() => setDetail(null)}
          onSaved={(updated) => { setNeeds(list => list.map(n => n.id === updated.id ? updated : n)); setDetail(updated) }}
          onDeleted={() => { setNeeds(list => list.filter(n => n.id !== detail.id)); setDetail(null) }}
        />
      )}
    </div>
  )
}
