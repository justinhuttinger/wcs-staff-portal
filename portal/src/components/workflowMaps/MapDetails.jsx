import { useState } from 'react'
import { createPortal } from 'react-dom'
import { LOCATION_OPTIONS } from '../../config/locations'
import { WORKFLOW_STATUSES } from './kinds'
import { TEMPLATES, exportPayload } from './templates'
import { inputCls, btnPrimary, btnGhost } from './ui'

export function downloadJson(map) {
  const blob = new Blob([JSON.stringify(exportPayload(map), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = (map.name || 'workflow').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-').toLowerCase() + '.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Modal({ title, onClose, children }) {
  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface rounded-xl border border-border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none" aria-label="Close">&times;</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

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

// Name, description and the workflow-level GHL details. Used for create,
// rename and the editor's settings button.
export function MapDetailsForm({ initial, submitLabel, onSubmit, onCancel, showTemplates = false }) {
  const [form, setForm] = useState({
    name: '', description: '', category: '', status: 'draft', clubs: [], ghl_workflow_url: '', ...initial,
  })
  const [template, setTemplate] = useState('blank')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Give the workflow a name'); return }
    setSaving(true); setError('')
    try { await onSubmit(form, template) } catch (err) { setError(err.message || 'Save failed'); setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {showTemplates && (
        <div>
          <label className="block text-xs font-semibold text-text-muted mb-1">Start from</label>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map(t => (
              <button key={t.key} type="button" onClick={() => {
                setTemplate(t.key)
                if (t.key !== 'blank' && !form.name) { const b = t.build(); setForm(f => ({ ...f, name: b.name, description: b.description, category: b.category })) }
              }}
                className={`text-left rounded-lg border p-3 transition-colors ${template === t.key ? 'border-wcs-red bg-wcs-red/5' : 'border-border bg-bg hover:border-text-muted'}`}>
                <span className="block text-sm font-semibold text-text-primary">{t.label}</span>
                <span className="block text-[11px] text-text-muted mt-0.5">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-text-muted mb-1">Name</label>
        <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} autoFocus maxLength={200} placeholder="e.g. New Lead Follow-up" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-text-muted mb-1">Description</label>
        <textarea className={inputCls} rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="What this workflow does and who it's for" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-text-muted mb-1">Folder</label>
          <input className={inputCls} value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Leads, Members, PT" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-muted mb-1">Status in GHL</label>
          <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}>
            {Object.entries(WORKFLOW_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-text-muted mb-1">Clubs (none = all clubs)</label>
        <ClubChips value={form.clubs} onChange={v => set('clubs', v)} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-text-muted mb-1">GHL workflow link (optional)</label>
        <input className={inputCls} value={form.ghl_workflow_url} onChange={e => set('ghl_workflow_url', e.target.value)} placeholder="https://app.gohighlevel.com/..." />
      </div>
      {error && <p className="text-xs text-wcs-red">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className={btnGhost} onClick={onCancel}>Cancel</button>
        <button type="submit" className={btnPrimary} disabled={saving}>{saving ? 'Saving...' : submitLabel}</button>
      </div>
    </form>
  )
}
