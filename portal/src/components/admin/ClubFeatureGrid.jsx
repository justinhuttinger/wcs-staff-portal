import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

// A club x feature grid of On/Off toggles, filtered to the features the caller
// cares about. Courts & Pool admin shows the two facilities; Group X admin
// shows Group X. One component and one endpoint, because they are rows in one
// table answering one question.
//
// `features` is the list of keys to show. Omit it to show everything.
export default function ClubFeatureGrid({ features, title, blurb }) {
  const [clubs, setClubs] = useState([])
  const [cols, setCols] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api('/club-features')
      setClubs(r.clubs || [])
      setCols((r.features || []).filter(f => !features || features.includes(f.key)))
      setRows(r.rows || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [features])

  useEffect(() => { load() }, [load])

  const enabled = (clubNumber, feature) =>
    rows.find(r => r.club_number === clubNumber && r.feature === feature)?.enabled ?? true

  async function toggle(clubNumber, feature, next) {
    const key = `${clubNumber}:${feature}`
    setSavingKey(key)
    setError(null)
    // Optimistic: a toggle that waits on a round trip before moving reads as
    // broken. Rolled back below if the write fails.
    const before = rows
    setRows(rs => rs.map(r =>
      r.club_number === clubNumber && r.feature === feature ? { ...r, enabled: next } : r))
    try {
      await api('/club-features', {
        method: 'PUT',
        body: JSON.stringify({ club_number: clubNumber, feature, enabled: next }),
      })
    } catch (e) {
      setRows(before)
      setError(e.message)
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-text-primary">{title}</h3>
        <p className="text-sm text-text-muted mt-1">{blurb}</p>
      </div>

      {error && <div className="px-4 py-3 text-sm text-red-900 bg-red-50 border-b border-red-200">{error}</div>}
      {loading && <div className="px-4 py-6 text-sm text-text-muted">Loading...</div>}

      {!loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left font-semibold text-text-primary px-4 py-2">Club</th>
                {cols.map(f => (
                  <th key={f.key} className="text-left font-semibold text-text-primary px-4 py-2">{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clubs.map(c => (
                <tr key={c.slug} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-medium text-text-primary">{c.name}</td>
                  {cols.map(f => {
                    const on = enabled(c.clubNumber, f.key)
                    const key = `${c.clubNumber}:${f.key}`
                    return (
                      <td key={f.key} className="px-4 py-2.5">
                        <button
                          type="button"
                          disabled={savingKey === key}
                          onClick={() => toggle(c.clubNumber, f.key, !on)}
                          className={`px-3 py-1 text-xs font-semibold rounded-full border transition disabled:opacity-50 ${
                            on
                              ? 'bg-green-50 border-green-300 text-green-800'
                              : 'bg-bg border-border text-text-muted'
                          }`}
                        >
                          {savingKey === key ? 'Saving...' : on ? 'On' : 'Off'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
