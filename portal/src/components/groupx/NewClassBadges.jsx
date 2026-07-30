import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

function addDays(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmt(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function NewClassBadges({ club, classTypes }) {
  const [flags, setFlags] = useState([])
  const [eventTypeId, setEventTypeId] = useState('')
  const [showUntil, setShowUntil] = useState(addDays(30))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await api(`/group-x/new-classes?club_number=${club.clubNumber}`)
      setFlags(r.new_classes || [])
    } catch (e) {
      setError(e.message)
    }
  }, [club.clubNumber])

  useEffect(() => { load() }, [load])

  async function save(e) {
    e.preventDefault()
    const type = classTypes.find(t => t.event_type_id === eventTypeId)
    if (!type) return
    setBusy(true)
    setError(null)
    try {
      await api('/group-x/new-classes', {
        method: 'PUT',
        body: JSON.stringify({
          club_number: club.clubNumber,
          event_type_id: type.event_type_id,
          class_name: type.name,
          show_until: showUntil,
        }),
      })
      setEventTypeId('')
      await load()
    } catch (err) {
      setError(err.message || 'Could not save the badge')
    } finally {
      setBusy(false)
    }
  }

  async function remove(f) {
    setBusy(true)
    setError(null)
    try {
      await api(`/group-x/new-classes/${encodeURIComponent(f.event_type_id)}?club_number=${club.clubNumber}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err.message || 'Could not remove the badge')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-text-primary">New class badges</h3>
        <p className="text-xs text-text-muted">
          Marks a class as new on the public board at {club.name}. Every session of that class
          gets the badge, including ones added later, and it switches itself off on the end date.
        </p>
      </div>

      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-text-muted mb-1">Class</label>
          <select value={eventTypeId} onChange={e => setEventTypeId(e.target.value)} required
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary">
            <option value="">Select a class</option>
            {classTypes.map(t => (
              <option key={t.event_type_id} value={t.event_type_id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Show until</label>
          <input type="date" value={showUntil} onChange={e => setShowUntil(e.target.value)} required
            className="border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
        </div>
        <button type="submit" disabled={!eventTypeId || busy}
          className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
          {busy ? 'Saving...' : 'Mark as new'}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{error}</div>
      )}

      {/* Nothing flagged means nothing listed. */}
      {flags.length > 0 && (
        <div className="divide-y divide-border">
          {flags.map(f => (
            <div key={f.event_type_id} className="py-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{f.class_name}</span>
              {f.active ? (
                <span className="px-2 py-0.5 text-[11px] rounded-full bg-wcs-red text-white font-medium">Showing</span>
              ) : (
                <span className="px-2 py-0.5 text-[11px] rounded-full bg-bg text-text-muted border border-border">Expired</span>
              )}
              <span className="text-xs text-text-muted">
                {f.active ? 'until' : 'ended'} {fmt(f.show_until)}
              </span>
              <button type="button" onClick={() => remove(f)} disabled={busy}
                className="ml-auto px-2.5 py-1 text-xs rounded-md border border-border text-text-primary hover:bg-bg disabled:opacity-50">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
