import { useState, useEffect } from 'react'
import { ticketing } from '../../../lib/api'
import DynamicFields from './DynamicFields'
import { PRIORITIES, fmtBytes } from './shared'

// Submit a new ticket: pick an active type, fill its fields, attach files.
export default function TicketSubmit({ onDone, onCancel }) {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState(null)
  const [values, setValues] = useState({})
  const [priority, setPriority] = useState('normal')
  const [files, setFiles] = useState([])
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    ticketing.listTypes(true)
      .then(res => setTypes(res.types || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function pick(t) {
    setType(t); setValues({}); setErrors({}); setFiles([]); setPriority('normal'); setError('')
  }

  async function submit() {
    setSubmitting(true); setError(''); setErrors({})
    try {
      const res = await ticketing.create({ type_id: type.id, data: values, priority })
      const ticketId = res.ticket.id
      // Upload attachments sequentially so a failure is easy to attribute.
      for (const f of files) {
        await ticketing.uploadAttachment(ticketId, f)
      }
      onDone(ticketId)
    } catch (err) {
      if (err.errors) setErrors(err.errors)
      setError(err.message || 'Could not submit ticket')
    } finally { setSubmitting(false) }
  }

  if (loading) return <p className="loading-card mx-auto block my-6">Loading…</p>

  // Step 1 — choose a type
  if (!type) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="text-sm text-text-muted hover:text-text-primary">← Back</button>
          <h3 className="text-sm font-bold text-text-primary">Choose a ticket type</h3>
        </div>
        {types.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-10 border border-dashed border-border rounded-xl">
            No active ticket types. Create one in the “Ticket Types” tab first.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {types.map(t => (
              <button key={t.id} onClick={() => pick(t)}
                className="text-left rounded-xl border border-border bg-surface p-4 hover:-translate-y-px hover:shadow-md transition-all">
                <p className="text-sm font-bold text-text-primary">{t.name}</p>
                {t.description && <p className="text-xs text-text-muted mt-1">{t.description}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Step 2 — fill the form
  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => setType(null)} className="text-sm text-text-muted hover:text-text-primary">← Change type</button>
        <h3 className="text-sm font-bold text-text-primary">{type.name}</h3>
      </div>

      <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
        <DynamicFields schema={type.schema || []} values={values} errors={errors}
          onChange={(id, v) => setValues(prev => ({ ...prev, [id]: v }))} />

        <div>
          <label className="block text-sm font-semibold text-text-primary mb-1">Priority</label>
          <div className="flex flex-wrap gap-1.5">
            {PRIORITIES.map(p => (
              <button key={p.key} type="button" onClick={() => setPriority(p.key)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-colors ${priority === p.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-text-primary mb-1">Attachments</label>
          <input type="file" multiple onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files)])}
            className="block w-full text-xs text-text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-wcs-red/10 file:text-wcs-red hover:file:bg-wcs-red/20" />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between text-xs bg-bg border border-border rounded-lg px-2.5 py-1.5">
                  <span className="truncate">{f.name} <span className="text-text-muted">({fmtBytes(f.size)})</span></span>
                  <button onClick={() => setFiles(files.filter((_, idx) => idx !== i))} className="text-red-500 ml-2 shrink-0">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-wcs-red">{error}</p>}

        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg">Cancel</button>
          <button onClick={submit} disabled={submitting} className="px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 disabled:opacity-40">
            {submitting ? 'Submitting…' : 'Submit Ticket'}
          </button>
        </div>
      </div>
    </div>
  )
}
