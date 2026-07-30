import { useState } from 'react'
import { api } from '../../lib/api'
import { fmtTime12, parseLocalTimestamp } from '../../lib/weekGrid'

export default function AttendanceModal({ club, classEvent, onClose, onSaved }) {
  const existing = classEvent.headcount != null
  const [headcount, setHeadcount] = useState(existing ? String(classEvent.headcount) : '')
  const [notes, setNotes] = useState(classEvent.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const parsed = parseLocalTimestamp(classEvent.event_timestamp_local)
  const n = parseInt(headcount, 10)
  const valid = Number.isInteger(n) && n >= 0 && n <= 500
  const cap = classEvent.max_attendees
  const fill = valid && cap > 0 ? Math.round((n / cap) * 100) : null

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api(`/group-x/classes/${encodeURIComponent(classEvent.event_id)}/attendance`, {
        method: 'PUT',
        body: JSON.stringify({
          club_number: club.clubNumber,
          headcount: n,
          notes: notes.trim() || null,
          event_timestamp: classEvent.event_timestamp,
          event_timestamp_local: classEvent.event_timestamp_local,
          event_type_id: classEvent.event_type_id,
          class_name: classEvent.class_name,
          employee_id: classEvent.employee_id,
          instructor_name: classEvent.instructor_name,
          max_attendees: classEvent.max_attendees,
        }),
      })
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not save the headcount')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">How many came?</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="text-sm">
            <div className="font-medium text-text-primary">{classEvent.class_name}</div>
            <div className="text-text-muted">
              {parsed ? `${parsed.date} at ${fmtTime12(parsed.hour, parsed.min)}` : classEvent.event_timestamp_local}
              {classEvent.instructor_name ? ` · ${classEvent.instructor_name}` : ''}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Attendees</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="500"
                value={headcount}
                onChange={e => setHeadcount(e.target.value)}
                autoFocus
                required
                className="w-28 border border-border rounded-lg px-3 py-2 text-2xl font-semibold bg-surface text-text-primary"
              />
              {cap > 0 && <span className="text-sm text-text-muted">of {cap} spots</span>}
            </div>
            {fill != null && (
              <div className="mt-1 text-xs text-text-muted">{fill}% full</div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything worth remembering about this class"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary"
            />
          </div>

          {existing && (
            <div className="text-xs text-text-muted">
              Already recorded{classEvent.recorded_by ? ` by ${classEvent.recorded_by}` : ''}. Saving replaces it.
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{error}</div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Cancel</button>
            <button type="submit" disabled={!valid || saving}
              className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
              {saving ? 'Saving...' : existing ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
