import { useEffect, useState } from 'react'
import { getStlBusinessHours, saveStlBusinessHours } from '../../lib/api'

// Postgres DOW order: 0 = Sunday.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function to12h(t) {
  const [h, m] = String(t || '').split(':').map(Number)
  if (!Number.isFinite(h)) return t
  const ap = h >= 12 ? 'pm' : 'am'
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')}${ap}`
}

/**
 * Per-club staffed window that Business-Hours Speed to Lead clamps to.
 * Saved straight to stl_business_hours_config, which the KPI report and this
 * page read live — so a change also re-clamps past leads when they are next
 * computed.
 */
export default function BusinessHoursEditor({ onSaved }) {
  const [clubs, setClubs] = useState(null)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(null)
  const [msg, setMsg] = useState({})
  const [error, setError] = useState('')

  useEffect(() => {
    getStlBusinessHours()
      .then(r => setClubs(r.clubs || []))
      .catch(e => setError(e.message || 'Failed to load business hours'))
  }, [])

  const valueOf = (c) => draft[c.location_id] || c
  const setField = (c, patch) =>
    setDraft(d => ({ ...d, [c.location_id]: { ...valueOf(c), ...patch } }))
  const dirty = (c) => {
    const d = draft[c.location_id]
    if (!d) return false
    return d.window_start !== c.window_start || d.window_end !== c.window_end
      || [...d.active_days].sort().join() !== [...c.active_days].sort().join()
  }

  async function save(c) {
    const v = valueOf(c)
    setSaving(c.location_id)
    setMsg(m => ({ ...m, [c.location_id]: null }))
    try {
      const saved = await saveStlBusinessHours(c.location_id, {
        window_start: v.window_start, window_end: v.window_end, active_days: v.active_days,
      })
      setClubs(list => list.map(x => x.location_id === c.location_id
        ? { ...x, ...saved, configured: true } : x))
      setDraft(d => { const n = { ...d }; delete n[c.location_id]; return n })
      setMsg(m => ({ ...m, [c.location_id]: { ok: true, text: 'Saved' } }))
      onSaved?.()
    } catch (e) {
      setMsg(m => ({ ...m, [c.location_id]: { ok: false, text: e.message || 'Save failed' } }))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="border border-border rounded-xl p-4 bg-bg/40">
      <h4 className="text-xs font-bold uppercase tracking-wide text-text-primary">Business hours by club</h4>
      <p className="text-[11px] text-text-muted mt-1">
        The staffed window each club's Business-Hours STL counts. Time outside it (and on unticked days) is clamped out.
        Changes apply everywhere STL is computed, including the KPI report, and re-clamp past leads too.
      </p>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {!clubs && !error && <p className="text-xs text-text-muted mt-2">Loading…</p>}
      {clubs && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                <th className="text-left py-2 pr-3">Club</th>
                <th className="text-left py-2 px-2">Opens</th>
                <th className="text-left py-2 px-2">Closes</th>
                <th className="text-left py-2 px-2">Days</th>
                <th className="py-2 pl-2" />
              </tr>
            </thead>
            <tbody>
              {clubs.map(c => {
                const v = valueOf(c)
                const m = msg[c.location_id]
                return (
                  <tr key={c.location_id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-semibold text-text-primary whitespace-nowrap">{c.name}</td>
                    <td className="py-2 px-2">
                      <input type="time" value={v.window_start} step="900"
                        onChange={e => setField(c, { window_start: e.target.value })}
                        className="px-2 py-1 rounded border border-border bg-bg text-text-primary" />
                    </td>
                    <td className="py-2 px-2">
                      <input type="time" value={v.window_end} step="900"
                        onChange={e => setField(c, { window_end: e.target.value })}
                        className="px-2 py-1 rounded border border-border bg-bg text-text-primary" />
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex gap-1">
                        {DAYS.map((d, i) => {
                          const on = v.active_days.includes(i)
                          return (
                            <button key={d} type="button"
                              onClick={() => setField(c, {
                                active_days: on ? v.active_days.filter(x => x !== i) : [...v.active_days, i],
                              })}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border'}`}>
                              {d}
                            </button>
                          )
                        })}
                      </div>
                    </td>
                    <td className="py-2 pl-2 whitespace-nowrap text-right">
                      {m && <span className={`mr-2 ${m.ok ? 'text-green-600' : 'text-red-600'}`}>{m.text}</span>}
                      {!dirty(c) && !m && (
                        <span className="mr-2 text-text-muted">{to12h(c.window_start)}–{to12h(c.window_end)}</span>
                      )}
                      <button type="button" onClick={() => save(c)}
                        disabled={!dirty(c) || saving === c.location_id}
                        className="text-xs bg-wcs-red text-white rounded-lg px-3 py-1 font-medium disabled:opacity-40">
                        {saving === c.location_id ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
