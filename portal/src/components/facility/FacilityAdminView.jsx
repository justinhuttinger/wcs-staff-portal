import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import FacilityBoardLinks from './FacilityBoardLinks'

// Courts & Pool, from the admin side. Same shape as the Group X admin page:
// the schedule itself lives on the home board, and what is left here is what is
// genuinely admin-only.
//
//   Boards & embeds  the TV link and the website iframe, per club and facility
//   Locations        which clubs actually have courts, and which have a pool
export default function FacilityAdminView() {
  const [tab, setTab] = useState('boards')
  const [clubs, setClubs] = useState([])
  const [facilities, setFacilities] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api('/facility-schedule/locations')
      setClubs(r.clubs || [])
      setFacilities(r.facilities || [])
      setRows(r.rows || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const enabled = (clubNumber, facility) =>
    rows.find(r => r.club_number === clubNumber && r.facility === facility)?.enabled ?? true

  async function toggle(clubNumber, facility, next) {
    const key = `${clubNumber}:${facility}`
    setSavingKey(key)
    setError(null)
    // Optimistic: a checkbox that waits on a round trip before moving feels
    // broken. Rolled back below if the write fails.
    const before = rows
    setRows(rs => rs.map(r =>
      r.club_number === clubNumber && r.facility === facility ? { ...r, enabled: next } : r))
    try {
      await api('/facility-schedule/locations', {
        method: 'PUT',
        body: JSON.stringify({ club_number: clubNumber, facility, enabled: next }),
      })
    } catch (e) {
      setRows(before)
      setError(e.message)
    } finally {
      setSavingKey(null)
    }
  }

  const TABS = [
    ['boards', 'Boards & embeds'],
    ['locations', 'Locations'],
  ]

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-1.5 flex flex-wrap gap-1.5">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              tab === key ? 'bg-wcs-red text-white font-medium' : 'text-text-primary hover:bg-bg'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-red-300 p-4 text-sm text-red-900">{error}</div>
      )}

      {tab === 'boards' && <FacilityBoardLinks clubs={clubs} facilities={facilities} />}

      {tab === 'locations' && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-text-primary">Which clubs have what</h3>
            <p className="text-sm text-text-muted mt-1">
              Switching a facility off hides its pill from staff and makes its board
              404 instead of showing an empty week. Nothing is deleted &mdash; events
              already scheduled stay, and come back if you switch it on again.
            </p>
          </div>

          {loading && <div className="px-4 py-6 text-sm text-text-muted">Loading...</div>}

          {!loading && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left font-semibold text-text-primary px-4 py-2">Club</th>
                    {facilities.map(f => (
                      <th key={f.slug} className="text-left font-semibold text-text-primary px-4 py-2">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clubs.map(c => (
                    <tr key={c.slug} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 font-medium text-text-primary">{c.name}</td>
                      {facilities.map(f => {
                        const on = enabled(c.clubNumber, f.slug)
                        const key = `${c.clubNumber}:${f.slug}`
                        return (
                          <td key={f.slug} className="px-4 py-2.5">
                            <button
                              type="button"
                              disabled={savingKey === key}
                              onClick={() => toggle(c.clubNumber, f.slug, !on)}
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
      )}
    </div>
  )
}
