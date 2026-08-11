import { useState, useEffect, useCallback } from 'react'
import { ticketing } from '../../../lib/api'
import { FIELD_PALETTE, FIELD_LABEL, OPTION_TYPES, newFieldId } from './shared'

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red'

// A single field row inside the editor: type badge, label, options, required,
// reorder + delete controls.
function FieldRow({ field, index, count, onChange, onMove, onRemove }) {
  const isDisplay = ['header', 'description', 'link'].includes(field.type)
  const [optionsText, setOptionsText] = useState((field.options || []).join('\n'))
  useEffect(() => { setOptionsText((field.options || []).join('\n')) }, [field.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="border border-border rounded-xl p-3 bg-bg/50">
      <div className="flex items-center gap-2 mb-2">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface border border-border text-text-muted shrink-0">
          {FIELD_LABEL[field.type]}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0}
            className="p-1 rounded hover:bg-surface disabled:opacity-30" title="Move up">▲</button>
          <button type="button" onClick={() => onMove(index, 1)} disabled={index === count - 1}
            className="p-1 rounded hover:bg-surface disabled:opacity-30" title="Move down">▼</button>
          <button type="button" onClick={() => onRemove(index)}
            className="p-1 rounded hover:bg-red-50 text-red-500" title="Remove">✕</button>
        </div>
      </div>

      <input value={field.label || ''} onChange={e => onChange(index, { label: e.target.value })}
        placeholder={field.type === 'header' ? 'Section heading' : field.type === 'description' ? 'Descriptive text' : field.type === 'link' ? 'Link text (e.g. Download the form)' : 'Field label'}
        className={inputClass + ' mb-2'} />

      {field.type === 'link' && (
        <input value={field.url || ''} onChange={e => onChange(index, { url: e.target.value })}
          placeholder="https://… (link to the file to download/print)"
          className={inputClass + ' mb-2'} />
      )}

      {OPTION_TYPES.includes(field.type) && (
        <textarea value={optionsText} rows={3}
          onChange={e => { setOptionsText(e.target.value); onChange(index, { options: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }) }}
          placeholder={'Option 1\nOption 2'} className={inputClass + ' mb-2'} />
      )}

      {!isDisplay && (
        <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
          <input type="checkbox" checked={!!field.required}
            onChange={e => onChange(index, { required: e.target.checked })} className="w-4 h-4 accent-wcs-red" />
          Required
        </label>
      )}
    </div>
  )
}

// Create/edit modal for a ticket type.
function TypeEditor({ initial, onClose, onSaved }) {
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [active, setActive] = useState(initial?.active ?? true)
  const [schema, setSchema] = useState(initial?.schema || [])
  const [handlerIds, setHandlerIds] = useState(initial?.handler_ids || [])
  const [staff, setStaff] = useState([])
  const [staffQuery, setStaffQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { ticketing.assignableStaff().then(r => setStaff(r.staff || [])).catch(() => {}) }, [])
  const staffFiltered = staff.filter(s => s.name.toLowerCase().includes(staffQuery.trim().toLowerCase()))
  function toggleHandler(id) {
    setHandlerIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  function addField(type) {
    const f = { id: newFieldId(), type }
    if (OPTION_TYPES.includes(type)) f.options = ['Option 1']
    if (!['header', 'description'].includes(type)) { f.label = ''; f.required = false }
    else f.label = ''
    setSchema(s => [...s, f])
  }
  function changeField(i, patch) { setSchema(s => s.map((f, idx) => idx === i ? { ...f, ...patch } : f)) }
  function moveField(i, dir) {
    setSchema(s => {
      const j = i + dir
      if (j < 0 || j >= s.length) return s
      const next = [...s]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function removeField(i) { setSchema(s => s.filter((_, idx) => idx !== i)) }

  async function save() {
    if (!name.trim()) { setError('Name is required'); return }
    // Client-side guard mirroring the server validator.
    for (const f of schema) {
      if (!['header', 'description'].includes(f.type) && !String(f.label || '').trim()) {
        setError(f.type === 'link' ? 'Every link needs link text' : 'Every field needs a label'); return
      }
      if (OPTION_TYPES.includes(f.type) && (!f.options || f.options.length === 0)) {
        setError(`"${f.label || f.type}" needs at least one option`); return
      }
      if (f.type === 'link' && !/^https?:\/\/.+/i.test(String(f.url || '').trim())) {
        setError(`"${f.label || 'Link'}" needs a valid http(s) URL`); return
      }
    }
    setSaving(true); setError('')
    try {
      const payload = { name, description, active, schema, handler_ids: handlerIds }
      if (initial?.id) await ticketing.updateType(initial.id, payload)
      else await ticketing.createType(payload)
      onSaved()
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-base font-bold text-text-primary">{initial?.id ? 'Edit Ticket Type' : 'New Ticket Type'}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">✕</button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. New Hire Request" className={inputClass} autoFocus />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer pb-2">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4 accent-wcs-red" />
                Active <span className="text-xs text-text-muted">(people can submit this type)</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">Description (optional)</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Shown under the tile" className={inputClass} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">
              Handlers <span className="font-normal">— who can work these tickets (edit, add progress, mark done). Admins always can.</span>
            </label>
            <input value={staffQuery} onChange={e => setStaffQuery(e.target.value)} placeholder="Search staff…"
              className={inputClass + ' mb-2'} />
            <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {staffFiltered.length === 0 ? (
                <p className="text-xs text-text-muted px-3 py-2">No staff match.</p>
              ) : staffFiltered.map(s => (
                <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-primary cursor-pointer hover:bg-bg">
                  <input type="checkbox" checked={handlerIds.includes(s.id)} onChange={() => toggleHandler(s.id)} className="w-4 h-4 accent-wcs-red" />
                  <span className="flex-1">{s.name}</span>
                  <span className="text-[10px] text-text-muted uppercase tracking-wide">{s.role}</span>
                </label>
              ))}
            </div>
            {handlerIds.length > 0 && <p className="text-[11px] text-text-muted mt-1">{handlerIds.length} handler{handlerIds.length === 1 ? '' : 's'} assigned</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-text-muted">Fields</label>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {FIELD_PALETTE.map(p => (
                <button key={p.type} type="button" onClick={() => addField(p.type)}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-border bg-bg text-text-primary hover:border-wcs-red hover:text-wcs-red transition-colors">
                  + {p.label}
                </button>
              ))}
            </div>
            {schema.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-6 border border-dashed border-border rounded-xl">
                Add fields above to build the form for this ticket type.
              </p>
            ) : (
              <div className="space-y-2">
                {schema.map((f, i) => (
                  <FieldRow key={f.id} field={f} index={i} count={schema.length}
                    onChange={changeField} onMove={moveField} onRemove={removeField} />
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-wcs-red">{error}</p>}
        </div>

        <div className="flex gap-3 justify-end px-6 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 disabled:opacity-40">
            {saving ? 'Saving…' : 'Save Type'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TicketTypeBuilder() {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null | {} (new) | type object

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await ticketing.listTypes()
      setTypes(res.types || [])
    } catch { /* silent */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function toggleActive(t) {
    try {
      await ticketing.updateType(t.id, { active: !t.active })
      await load()
    } catch { /* silent */ }
  }
  async function remove(t) {
    if (!confirm(`Delete "${t.name}"? This can't be undone.`)) return
    try {
      await ticketing.deleteType(t.id)
      await load()
    } catch (err) {
      alert(err.message || 'Could not delete. Deactivate it instead.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">Build the ticket types people can submit. Inactive types are hidden from submitters but keep their history.</p>
        <button onClick={() => setEditing({})} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 shrink-0">
          + New Type
        </button>
      </div>

      {loading ? (
        <p className="loading-card mx-auto block my-6">Loading…</p>
      ) : types.length === 0 ? (
        <div className="text-center py-10 bg-surface border border-border rounded-xl">
          <p className="text-sm text-text-muted">No ticket types yet</p>
          <p className="text-xs text-text-muted mt-1">Click “+ New Type” to build your first one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {types.map(t => {
            const fieldCount = (t.schema || []).filter(f => !['header', 'description'].includes(f.type)).length
            return (
              <div key={t.id} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-text-primary truncate">{t.name}</p>
                    {t.active
                      ? <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200">Active</span>
                      : <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500 border border-gray-200">Inactive</span>}
                  </div>
                  {t.description && <p className="text-xs text-text-muted mt-0.5 truncate">{t.description}</p>}
                  <p className="text-[11px] text-text-muted mt-0.5">{fieldCount} field{fieldCount === 1 ? '' : 's'}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleActive(t)} className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary">
                    {t.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => setEditing(t)} className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-border bg-bg text-text-primary hover:border-wcs-red hover:text-wcs-red">Edit</button>
                  <button onClick={() => remove(t)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Delete">✕</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <TypeEditor initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}
