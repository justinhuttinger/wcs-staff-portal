import { useState } from 'react'
import { api } from '../../lib/api'

export default function CreateEventModal({ club, facility, defaultDate, defaultTime, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [staffName, setStaffName] = useState('')
  const [date, setDate] = useState(defaultDate || '')
  const [time, setTime] = useState(defaultTime || '06:00')
  const [duration, setDuration] = useState(60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await api('/facility-schedule/events', {
        method: 'POST',
        body: JSON.stringify({
          club_number: club.clubNumber,
          facility: facility.slug,
          title: title.trim(),
          staff_name: staffName.trim() || null,
          date,
          time,
          duration_minutes: duration,
        }),
      })
      onCreated()
    } catch (err) {
      setError(err.message || 'Could not create the event')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = title.trim() && date && time && duration > 0 && !saving

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">Add {facility.label} event at {club.name}</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} required maxLength={80}
              placeholder="Lap Swim, Open Pickleball, Swim Lessons"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Start</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Minutes</label>
              <input type="number" min="5" step="5" max="1440" value={duration}
                onChange={e => setDuration(parseInt(e.target.value, 10) || 0)} required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Staff name (optional)</label>
            <input type="text" value={staffName} onChange={e => setStaffName(e.target.value)} maxLength={60}
              placeholder="Leave blank for open swim or open court"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
          </div>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Cancel</button>
            <button type="submit" disabled={!canSubmit}
              className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
              {saving ? 'Saving...' : 'Add event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
