import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import FacilityBoardLinks from './FacilityBoardLinks'
import ClubFeatureGrid from '../admin/ClubFeatureGrid'

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
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await api('/facility-schedule/facilities')
      setClubs(r.clubs || [])
      setFacilities(r.facilities || [])
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

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
        <ClubFeatureGrid
          features={['courts', 'pool']}
          title="Which clubs have what"
          blurb="Switching a facility off hides its pill from staff and makes its board 404 instead of showing an empty week. Nothing is deleted - events already scheduled stay, and come back if you switch it on again."
        />
      )}
    </div>
  )
}
