import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import BoardLinks from './BoardLinks'
import NewClassBadges from './NewClassBadges'
import GroupXReport from './GroupXReport'

// Group X, from the admin side.
//
// The Admin Panel used to carry two full copies of the staff screens --
// "Group X Scheduling" and "Group X Attendance" -- which were the same
// scheduler and the same attendance queue that now live on the home board.
// Two ways into one screen is two places to look and two places to fix, and
// the admin copies were the ones nobody used day to day.
//
// What is genuinely admin-only is what is left here: where the boards are
// pointed, which classes wear a NEW badge, and the cross-club history. None of
// those belong on a screen whose job is clearing today's queue.
export default function GroupXAdminView() {
  const [clubs, setClubs] = useState([])
  const [club, setClub] = useState(null)
  const [classTypes, setClassTypes] = useState([])
  const [tab, setTab] = useState('boards')
  const [error, setError] = useState(null)

  useEffect(() => {
    api('/group-x/clubs')
      .then(r => { setClubs(r.clubs || []); setClub((r.clubs || [])[0] || null) })
      .catch(e => setError(e.message))
  }, [])

  // Badges are per class TYPE, so the picker needs the club's types. Only
  // fetched for the tab that uses them -- the boards and the history do not
  // care, and this is an ABC round trip behind an hour-long cache.
  useEffect(() => {
    if (!club || tab !== 'badges') return
    let live = true
    api(`/group-x/class-types?club_number=${club.clubNumber}`)
      .then(r => { if (live) setClassTypes(r.class_types || []) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [club, tab])

  const TABS = [
    ['boards', 'Boards & embeds', 'The TV links and the website iframe, per club'],
    ['badges', 'New class badges', 'What wears a NEW pill, and until when'],
    ['history', 'History', 'Headcounts by class and instructor, across clubs'],
  ]

  if (!club) {
    return (
      <div className="bg-surface rounded-xl border border-border p-6 text-sm text-text-muted">
        {error ? `Could not load clubs: ${error}` : 'Loading...'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-1.5 flex flex-wrap gap-1.5">
        {TABS.map(([key, label, hint]) => (
          <button key={key} type="button" onClick={() => setTab(key)} title={hint}
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

      {/* The club picker only applies to badges. Board links list every club at
          once (that is the point of the page) and the history has its own
          club filter including an all-clubs roll-up. */}
      {tab === 'badges' && (
        <div className="bg-surface rounded-xl border border-border px-3 py-2.5 flex flex-wrap items-center gap-1.5">
          {clubs.map(c => (
            <button
              key={c.slug}
              type="button"
              onClick={() => setClub(c)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                c.slug === club.slug
                  ? 'bg-wcs-red text-white border-wcs-red font-medium'
                  : 'border-border text-text-primary hover:bg-bg'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {tab === 'boards' && <BoardLinks clubs={clubs} />}
      {tab === 'badges' && <NewClassBadges club={club} classTypes={classTypes} />}
      {tab === 'history' && <GroupXReport clubs={clubs} />}
    </div>
  )
}
