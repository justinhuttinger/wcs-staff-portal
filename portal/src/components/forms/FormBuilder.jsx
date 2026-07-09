import { useEffect, useMemo, useRef, useState } from 'react'
import { forms as formsApi } from '../../lib/api'
import FieldEditor from './FieldEditor'
import FormPreview from './FormPreview'
import FormSharePanel from './FormSharePanel'
import FormQrPanel from './FormQrPanel'
import FormAuditPanel from './FormAuditPanel'

// Mirror the backend role canonicalization (auth/src/middleware/role.js):
// front_desk/personal_trainer -> team_member, director -> corporate; custom sits
// between lead and manager, marketing at/above corporate.
const ROLE_ALIASES = { front_desk: 'team_member', personal_trainer: 'team_member', director: 'corporate' }
const ROLE_LEVELS = { team_member: 0, lead: 1, custom: 2, manager: 3, corporate: 4, marketing: 5, admin: 6 }
const roleLevel = (role) => ROLE_LEVELS[ROLE_ALIASES[role] || role] ?? 0

const STATUS_STYLES = {
  draft: 'bg-gray-100 border border-gray-200 text-gray-600',
  published: 'bg-green-50 border border-green-200 text-green-700',
  archived: 'bg-amber-50 border border-amber-200 text-amber-700',
}

const FIELD_TYPES = [
  { type: 'short_text', label: 'Short Text' },
  { type: 'long_text', label: 'Long Text' },
  { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Phone' },
  { type: 'number', label: 'Number' },
  { type: 'dropdown', label: 'Dropdown' },
  { type: 'radio', label: 'Radio Buttons' },
  { type: 'checkbox', label: 'Checkboxes' },
  { type: 'date', label: 'Date' },
  { type: 'header', label: 'Section Header' },
  { type: 'description', label: 'Paragraph Text' },
]
const TYPE_LABELS = Object.fromEntries(FIELD_TYPES.map(t => [t.type, t.label]))
const OPTION_TYPES = ['dropdown', 'radio', 'checkbox']
const DISPLAY_TYPES = ['header', 'description']

const TABS = [
  { key: 'build', label: 'Build' },
  { key: 'settings', label: 'Settings' },
  { key: 'share', label: 'Share' },
  { key: 'qr', label: 'QR' },
  { key: 'audit', label: 'Audit' },
]

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'

function newFieldId(existingIds) {
  let id
  do { id = 'f_' + Math.random().toString(36).slice(2, 8) } while (existingIds.has(id))
  return id
}

function makeField(type, existingIds) {
  const field = { id: newFieldId(existingIds), type, label: TYPE_LABELS[type] }
  if (type === 'description') { field.label = ''; field.help_text = 'Paragraph text' }
  if (!DISPLAY_TYPES.includes(type)) field.required = false
  if (OPTION_TYPES.includes(type)) field.options = ['Option 1', 'Option 2']
  return field
}

export default function FormBuilder({ formId, onBack, me }) {
  const [form, setForm] = useState(null)
  const [shares, setShares] = useState([])
  const [loadError, setLoadError] = useState('')

  // Working copies + a JSON baseline for dirty tracking.
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [schema, setSchema] = useState([])
  const [successMessage, setSuccessMessage] = useState('')
  const [allowResubmit, setAllowResubmit] = useState(false)
  const [baseline, setBaseline] = useState('')

  const introRef = useRef(null)

  const [selectedId, setSelectedId] = useState(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [tab, setTab] = useState('build')

  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [sheetWarning, setSheetWarning] = useState('')
  const [copiedField, setCopiedField] = useState(null)
  const [submissionCount, setSubmissionCount] = useState(null)

  const canEdit = !!form?.access?.edit
  const isCorporate = roleLevel(me?.role) >= ROLE_LEVELS.corporate
  // Settings map to the backend settings blob. Kept in the same dirty/baseline
  // snapshot as title/description/schema so one Save covers everything.
  const settings = useMemo(
    () => ({ success_message: successMessage, allow_resubmit: allowResubmit }),
    [successMessage, allowResubmit]
  )
  const dirty = useMemo(
    () => baseline !== '' && JSON.stringify({ title, description, schema, settings }) !== baseline,
    [baseline, title, description, schema, settings]
  )
  const selectedField = schema.find(f => f.id === selectedId) || null
  const publicUrl = form?.slug ? `https://forms.westcoaststrength.com/f/${form.slug}` : ''

  function syncLoaded(f) {
    const t = f.title || ''
    const d = f.description || ''
    const s = Array.isArray(f.schema) ? f.schema : []
    const set = f.settings || {}
    const sm = typeof set.success_message === 'string' ? set.success_message : ''
    const ar = !!set.allow_resubmit
    setForm(f)
    setTitle(t)
    setDescription(d)
    setSchema(s)
    setSuccessMessage(sm)
    setAllowResubmit(ar)
    setEditingTitle(false)
    setBaseline(JSON.stringify({
      title: t, description: d, schema: s,
      settings: { success_message: sm, allow_resubmit: ar },
    }))
  }

  async function load() {
    setLoadError('')
    setConflict(false)
    setActionError('')
    try {
      const res = await formsApi.get(formId)
      syncLoaded(res.form)
      setShares(res.shares || [])
      if (res.form.status === 'draft') {
        try {
          const subs = await formsApi.submissions(formId)
          setSubmissionCount(subs.total || 0)
        } catch { setSubmissionCount(null) }
      } else {
        setSubmissionCount(null)
      }
    } catch (err) {
      setLoadError(err.message || 'Failed to load form')
    }
  }
  useEffect(() => { load() }, [formId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Grow the intro textarea to fit its content so the whole intro stays visible
  // while editing. Runs on change and whenever the value loads or the tab remounts it.
  function resizeIntro() {
    const el = introRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  useEffect(() => { resizeIntro() }, [description, tab])

  function handleBack() {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return
    onBack()
  }

  function copyToClipboard(text, fieldKey) {
    navigator.clipboard.writeText(text)
    setCopiedField(fieldKey)
    setTimeout(() => setCopiedField(null), 1500)
  }

  // --- Field operations (ids are never regenerated on edit) ---
  function addField(type) {
    const field = makeField(type, new Set(schema.map(f => f.id)))
    setSchema(s => [...s, field])
    setSelectedId(field.id)
    setAddMenuOpen(false)
  }

  function updateField(id, patch) {
    setSchema(s => s.map(f => (f.id === id ? { ...f, ...patch } : f)))
  }

  function moveField(index, delta) {
    setSchema(s => {
      const next = [...s]
      const target = index + delta
      if (target < 0 || target >= next.length) return s
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function deleteField(id) {
    if (!window.confirm('Delete this field?')) return
    setSchema(s => s.filter(f => f.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  // --- Form actions ---
  async function save() {
    if (!title.trim()) { setActionError('Title is required'); return }
    setSaving(true)
    setActionError('')
    try {
      const res = await formsApi.update(formId, {
        known_updated_at: form.updated_at,
        title, description, schema, settings,
      })
      syncLoaded(res.form)
      setConflict(false)
    } catch (err) {
      if ((err.message || '').includes('changed since you opened it')) {
        setConflict(true)
      } else {
        setActionError(err.message || 'Failed to save form')
      }
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    setPublishing(true)
    setActionError('')
    setSheetWarning('')
    try {
      const res = await formsApi.publish(formId)
      setForm(f => ({ ...f, ...res.form }))
      if (res.sheet_error) {
        setSheetWarning(`Form published. Google Sheet could not be created yet: ${res.sheet_error}. Submissions are safe and will sync once the sheet connects.`)
      }
      setTab('qr')
    } catch (err) {
      setActionError(err.message || 'Failed to publish form')
    } finally {
      setPublishing(false)
    }
  }

  async function archive() {
    if (!window.confirm('Archive this form? The public link will stop accepting submissions.')) return
    setActionError('')
    try {
      const res = await formsApi.archive(formId)
      setForm(f => ({ ...f, ...res.form }))
    } catch (err) {
      setActionError(err.message || 'Failed to archive form')
    }
  }

  async function remove() {
    if (!window.confirm('Delete this draft form? This cannot be undone.')) return
    setActionError('')
    try {
      await formsApi.remove(formId)
      onBack()
    } catch (err) {
      setActionError(err.message || 'Failed to delete form')
    }
  }

  // --- Render ---
  if (loadError) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4 w-full">
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{loadError}</div>
        <button onClick={onBack} className="px-4 py-2 text-sm text-text-muted border border-border rounded-lg hover:text-text-primary transition-colors">
          Back to Forms
        </button>
      </div>
    )
  }
  if (!form) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 w-full">
        <div className="loading-card" />
      </div>
    )
  }

  const canPublish = canEdit && (form.status === 'draft' || form.status === 'archived')
  const canArchive = canEdit && form.status === 'published'
  const canDelete = canEdit && form.status === 'draft' && submissionCount === 0

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4 w-full">
      {/* Header */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={handleBack}
            className="px-3 py-1.5 text-xs text-text-muted border border-border rounded-lg hover:text-text-primary transition-colors">
            &larr; Back
          </button>
          {canEdit ? (
            editingTitle ? (
              <input
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); setEditingTitle(false) }
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
                placeholder="Untitled Form"
                aria-label="Form name"
                className="flex-1 min-w-0 text-lg font-bold text-text-primary bg-bg border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-wcs-red"
              />
            ) : (
              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                <h2
                  onClick={() => setEditingTitle(true)}
                  className="text-lg font-bold text-text-primary min-w-0 truncate cursor-text hover:opacity-80"
                  title="Click to rename"
                >
                  {title || 'Untitled Form'}
                </h2>
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  title="Rename form"
                  aria-label="Rename form"
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                </button>
              </div>
            )
          ) : (
            <h2 className="text-lg font-bold text-text-primary flex-1 min-w-0 truncate">{title || 'Untitled Form'}</h2>
          )}
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${STATUS_STYLES[form.status] || STATUS_STYLES.draft}`}>
            {form.status.charAt(0).toUpperCase() + form.status.slice(1)}
          </span>
          {dirty && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Unsaved changes
            </span>
          )}
          {canEdit && (
            <div className="flex items-center gap-2">
              {canDelete && (
                <button onClick={remove}
                  className="px-3 py-1.5 text-xs text-wcs-red border border-red-200 rounded-lg hover:bg-red-50 transition-colors">
                  Delete
                </button>
              )}
              {canArchive && (
                <button onClick={archive}
                  className="px-3 py-1.5 text-xs text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors">
                  Archive
                </button>
              )}
              {canPublish && (
                <button onClick={publish} disabled={publishing || dirty}
                  title={dirty ? 'Save your changes first' : undefined}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
                  {publishing ? 'Publishing...' : 'Publish'}
                </button>
              )}
              <button onClick={save} disabled={saving || !dirty}
                className="px-4 py-1.5 text-xs font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>
        {form.status === 'published' && publicUrl && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="font-semibold">Public link:</span>
            <a href={publicUrl} target="_blank" rel="noreferrer" className="text-wcs-red hover:underline truncate">{publicUrl}</a>
            <button
              type="button"
              onClick={() => copyToClipboard(publicUrl, 'public-url')}
              className="text-wcs-red hover:text-wcs-red/70 transition-colors relative"
              title="Copy link"
            >
              {copiedField === 'public-url' ? (
                <span className="text-[10px] text-green-600 font-semibold animate-pulse">Copied!</span>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                </svg>
              )}
            </button>
          </div>
        )}
        {!canEdit && (
          <p className="text-xs text-text-muted">View only. You do not have edit access to this form.</p>
        )}
      </div>

      {/* Conflict banner */}
      {conflict && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm flex flex-wrap items-center gap-3">
          <span className="flex-1 min-w-0">This form changed since you opened it. Reload to get the latest version. Reloading discards your unsaved edits.</span>
          <button onClick={load}
            className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:opacity-90 transition-opacity">
            Reload
          </button>
        </div>
      )}

      {/* Sheet warning after publish */}
      {sheetWarning && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm flex items-start gap-3">
          <span className="flex-1">{sheetWarning}</span>
          <button onClick={() => setSheetWarning('')} className="text-amber-800 hover:opacity-70 text-lg leading-none">&times;</button>
        </div>
      )}

      {actionError && (
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{actionError}</div>
      )}

      {/* Tab bar */}
      <div className="bg-surface border border-border rounded-xl p-2 flex flex-wrap gap-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'settings' && (
        <div className="bg-surface rounded-xl border border-border p-5 space-y-5">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Form settings</h3>
            <p className="text-xs text-text-muted mt-0.5">Control what people see after they submit this form.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">Completion heading</label>
            <textarea
              value={successMessage}
              onChange={e => setSuccessMessage(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={!canEdit}
              placeholder="Thanks, you're signed up."
              className={inputClass}
            />
            <p className="text-[11px] text-text-muted mt-1">Shown as the big heading after someone submits. The line "We have received your response." always appears under it. Leave blank for the default heading.</p>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-text-primary">Allow submitting another response</p>
              <p className="text-[11px] text-text-muted mt-0.5">Shows a button on the completion screen to fill out the form again.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={allowResubmit}
              disabled={!canEdit}
              onClick={() => setAllowResubmit(v => !v)}
              className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
                allowResubmit ? 'bg-wcs-red' : 'bg-border'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                allowResubmit ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>
      )}

      {tab === 'share' && <FormSharePanel form={form} shares={shares} onChanged={load} />}
      {tab === 'qr' && <FormQrPanel form={form} />}
      {tab === 'audit' && <FormAuditPanel form={form} isCorporate={isCorporate} />}

      {tab === 'build' && (
        <>
          {/* Title + description */}
          <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-1">Form title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} disabled={!canEdit}
                className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-1">Intro text (optional)</label>
              <textarea ref={introRef} value={description}
                onChange={e => { setDescription(e.target.value); resizeIntro() }}
                rows={2} disabled={!canEdit}
                className={`${inputClass} resize-none`} />
            </div>
          </div>

          {/* Two-pane editor */}
          <div className="flex flex-col md:flex-row gap-4 items-start">
            {/* Left: field list */}
            <div className="w-full md:w-80 shrink-0 bg-surface rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-text-primary">Fields</h3>
                {canEdit && (
                  <div className="relative">
                    <button onClick={() => setAddMenuOpen(o => !o)}
                      className="px-3 py-1.5 text-xs font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity">
                      Add Field
                    </button>
                    {addMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setAddMenuOpen(false)} />
                        <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-surface border border-border rounded-xl shadow-lg py-1 max-h-72 overflow-y-auto">
                          {FIELD_TYPES.map(t => (
                            <button key={t.type} onClick={() => addField(t.type)}
                              className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg transition-colors">
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              {schema.length === 0 ? (
                <p className="text-xs text-text-muted py-4 text-center">
                  {canEdit ? 'No fields yet. Add your first field.' : 'No fields yet.'}
                </p>
              ) : (
                <div className="space-y-1">
                  {schema.map((f, i) => {
                    const display = DISPLAY_TYPES.includes(f.type)
                    const name = display
                      ? (f.type === 'header' ? (f.label || 'Section Header') : (f.help_text || 'Paragraph Text'))
                      : (f.label || TYPE_LABELS[f.type])
                    return (
                      <div key={f.id}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${
                          selectedId === f.id ? 'border-wcs-red bg-wcs-red/5' : 'border-border bg-surface hover:bg-bg'
                        }`}
                        onClick={() => setSelectedId(f.id)}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {f.required && <span className="w-1.5 h-1.5 rounded-full bg-wcs-red shrink-0" title="Required" />}
                            <span className="text-sm font-medium text-text-primary truncate">{name}</span>
                          </div>
                          <span className="block text-[11px] text-text-muted">{TYPE_LABELS[f.type]}</span>
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button onClick={e => { e.stopPropagation(); moveField(i, -1) }} disabled={i === 0}
                              title="Move up"
                              className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-muted">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                              </svg>
                            </button>
                            <button onClick={e => { e.stopPropagation(); moveField(i, 1) }} disabled={i === schema.length - 1}
                              title="Move down"
                              className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-muted">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                              </svg>
                            </button>
                            <button onClick={e => { e.stopPropagation(); deleteField(f.id) }}
                              title="Delete field"
                              className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-wcs-red">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Right: field settings */}
            <div className="flex-1 min-w-0 w-full bg-surface rounded-xl border border-border p-4">
              {selectedField ? (
                <FieldEditor
                  key={selectedField.id}
                  field={selectedField}
                  typeLabel={TYPE_LABELS[selectedField.type]}
                  disabled={!canEdit}
                  onChange={patch => updateField(selectedField.id, patch)}
                />
              ) : (
                <p className="text-sm text-text-muted py-8 text-center">Select a field to edit its settings.</p>
              )}
            </div>
          </div>

          {/* Live preview */}
          <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text-primary">Preview</h3>
              <button onClick={() => setShowPreview(p => !p)}
                className="px-3 py-1.5 text-xs text-text-muted border border-border rounded-lg hover:text-text-primary transition-colors">
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
            </div>
            {showPreview && (
              <div className="bg-bg rounded-xl p-4 sm:p-6">
                <FormPreview schema={schema} title={title} description={description} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
