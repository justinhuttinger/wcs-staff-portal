import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

export default function CreateClassModal({ club, classTypes, instructors, defaultDate, onClose, onCreated }) {
  const [eventTypeId, setEventTypeId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState(defaultDate || '')
  const [time, setTime] = useState('06:00')
  const [levelId, setLevelId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selectedType = classTypes.find(t => t.event_type_id === eventTypeId) || null

  // Auto-select the training level when the class type has exactly one, which
  // is the case for all 6 WCS class types today.
  useEffect(() => {
    if (!selectedType) return
    const levels = selectedType.training_levels || []
    setLevelId(levels.length === 1 ? levels[0].level_id : '')
  }, [eventTypeId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api('/group-x/classes', {
        method: 'POST',
        body: JSON.stringify({
          club_number: club.clubNumber,
          event_type_id: eventTypeId,
          employee_id: employeeId,
          date,
          time,
          training_level_id: levelId || null,
        }),
      })
      onCreated()
    } catch (err) {
      // Surface ABC's own message. Its API-CAL-EVT-* codes are the diagnostic,
      // and hiding them behind "something went wrong" wastes everyone's time.
      setError(err.message || 'Failed to create the class')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = eventTypeId && employeeId && date && time && !saving

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">Add class at {club.name}</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Class</label>
            <select
              value={eventTypeId}
              onChange={e => setEventTypeId(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary"
              required
            >
              <option value="">Select a class</option>
              {classTypes.map(t => (
                <option key={t.event_type_id} value={t.event_type_id}>
                  {t.name}{t.max_attendees ? ` (max ${t.max_attendees})` : ''}
                </option>
              ))}
            </select>
            {selectedType?.description && (
              <p className="mt-1 text-xs text-text-muted">{selectedType.description}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Instructor</label>
            <select
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary"
              required
            >
              <option value="">Select an instructor</option>
              {instructors.map(i => (
                <option key={i.employee_id} value={i.employee_id}>
                  {i.display_name} ({i.department})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>
            <div>
              {/* Read-only: ABC takes duration from the class type and ignores
                  any value sent on create. An editable box here would lie. */}
              <label className="block text-xs font-medium text-text-muted mb-1">Length</label>
              <div className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-muted">
                {selectedType?.duration_minutes ? `${selectedType.duration_minutes} min` : 'Set by class'}
              </div>
            </div>
          </div>

          {(selectedType?.training_levels?.length || 0) > 1 && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Training level</label>
              <select value={levelId} onChange={e => setLevelId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary">
                <option value="">Select a level</option>
                {selectedType.training_levels.map(l => (
                  <option key={l.level_id} value={l.level_id}>{l.level_name}</option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              <div className="font-semibold mb-0.5">ABC rejected this class</div>
              <div className="break-words">{error}</div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit}
              className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
              {saving ? 'Creating in ABC...' : 'Create class'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
