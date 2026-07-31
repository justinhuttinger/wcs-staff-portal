import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmt(iso) {
  if (!iso) return null
  return new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function time12(t) {
  const m = /^(\d{2}):(\d{2})/.exec(String(t || ''))
  if (!m) return t
  const h = parseInt(m[1], 10)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${suffix}`
}

// Classes come back from ABC with no link to the series that created them, so
// unlike the facility side this cannot hang off a class popover. Repeating
// classes get their own list.
export default function SeriesList({ club, onChanged }) {
  const [series, setSeries] = useState([])
  const [through, setThrough] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await api(`/group-x/series?club_number=${club.clubNumber}`)
      setSeries(r.series || [])
    } catch (e) { setError(e.message) }
  }, [club.clubNumber])

  useEffect(() => { load() }, [load])

  async function endSeries(s) {
    const date = through[s.id] || ''
    const msg = date
      ? `Keep ${s.class_name} through ${date} and cancel every class after it?`
      : `Cancel every remaining ${s.class_name} class from today onwards?`
    if (!window.confirm(msg)) return
    setBusy(true)
    setError(null)
    try {
      const qs = date ? `?through=${date}` : ''
      const r = await api(`/group-x/series/${encodeURIComponent(s.id)}${qs}`, { method: 'DELETE' })
      await load()
      if (onChanged) await onChanged()
      if (r.failed) setError(`${r.canceled} cancelled, ${r.failed} could not be cancelled in ABC.`)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-text-primary">Repeating classes</h3>
        <p className="text-xs text-text-muted">
          Pick a last day to keep, or leave it blank to cancel everything from today.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{error}</div>
      )}

      {/* Nothing repeating means nothing listed. */}
      {series.length === 0 ? (
        <p className="text-sm text-text-muted">No repeating classes at {club.name}.</p>
      ) : (
        <div className="divide-y divide-border">
          {series.map(s => (
            <div key={s.id} className="py-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[180px]">
                <div className="text-sm font-medium text-text-primary">{s.class_name}</div>
                <div className="text-xs text-text-muted">
                  {(s.weekdays || []).map(d => DAY_LABELS[d]).join(', ')} at {time12(s.start_time)}
                  {s.instructor_name ? ` · ${s.instructor_name}` : ''}
                </div>
                <div className="text-xs text-text-muted">
                  {s.ends_on
                    ? `Until ${fmt(s.ends_on)}`
                    : `No end date · created through ${fmt(s.materialized_through) || 'soon'}`}
                </div>
              </div>
              <div className="ml-auto flex items-end gap-2">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Keep through</label>
                  <input type="date" value={through[s.id] || ''}
                    onChange={e => setThrough(t => ({ ...t, [s.id]: e.target.value }))}
                    className="border border-border rounded-lg px-2 py-1.5 text-sm bg-surface text-text-primary" />
                </div>
                <button type="button" onClick={() => endSeries(s)} disabled={busy}
                  className="px-3 py-1.5 text-sm rounded-lg border border-red-300 bg-red-50 text-red-900 font-medium hover:bg-red-100 disabled:opacity-50">
                  {through[s.id] ? 'End series' : 'Cancel all'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
