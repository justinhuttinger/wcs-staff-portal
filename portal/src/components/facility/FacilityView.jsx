import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../../lib/api'
import { startOfWeek, addDays, toISODate, fmtTime12, parseLocalTimestamp, MONTH_LABELS } from '../../lib/weekGrid'
import WeekGrid from '../groupx/WeekGrid'
import BoardLinks from './FacilityBoardLinks'
import PrintBoardModal from '../schedule/PrintBoardModal'
import CreateEventModal from './CreateEventModal'
import EditEventModal from './EditEventModal'

function weekLabel(weekStart) {
  const end = addDays(weekStart, 6)
  const a = `${MONTH_LABELS[weekStart.getMonth()]} ${weekStart.getDate()}`
  const b = weekStart.getMonth() === end.getMonth()
    ? `${end.getDate()}`
    : `${MONTH_LABELS[end.getMonth()]} ${end.getDate()}`
  return `${a} - ${b}, ${end.getFullYear()}`
}

// The shared WeekGrid speaks the Group X shape, so facility events are mapped
// onto it rather than forking a second grid.
function toGridShape(e) {
  return {
    event_id: e.id,
    event_type_id: e.title,      // colours the block by event name
    class_name: e.title,
    instructor_name: e.staff_name || null,
    event_timestamp_local: e.starts_at_local,
    duration_minutes: e.duration_minutes,
    status: 'Pending',
    series_id: e.series_id,
  }
}

// `canEdit` splits the two audiences, exactly as GroupXView does. Everyone can
// read and print the court and pool weeks; lead and above get the write
// controls. Defaults to FALSE so a caller that forgets to pass it hands out the
// read-only screen.
//
// `showBoardLinks` is separate: the TV and website embed URLs are an admin
// concern, handed out once when a board is set up.
export default function FacilityView({ canEdit = false, showBoardLinks = false }) {
  const [clubs, setClubs] = useState([])
  const [allFacilities, setAllFacilities] = useState([])
  const [club, setClub] = useState(null)
  const [facility, setFacility] = useState(null)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [createOpen, setCreateOpen] = useState(null)
  const [linksOpen, setLinksOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('/facility-schedule/facilities')
      .then(r => {
        const list = r.clubs || []
        setClubs(list)
        // Prefer a club that has a facility. Falling back to list[0] keeps the
        // "none of my clubs have one" case on a real club, so the message
        // above can name it.
        setClub(list.find(c => !Array.isArray(c.facilities) || c.facilities.length) || list[0] || null)
        setAllFacilities(r.facilities)
      })
      .catch(e => setError(e.message))
  }, [])

  // Only the facilities this club actually has. A club with no pool should not
  // be offered a Pool pill that leads to a permanently empty week -- which
  // reads as "nothing booked" rather than "there is no pool". The server sends
  // the list per club; see Admin -> Courts & Pool -> Locations.
  const facilities = useMemo(() => {
    if (!club) return []
    // A club with no facilities list at all is one the server has not scoped,
    // so show everything rather than an empty screen.
    if (!Array.isArray(club.facilities)) return allFacilities
    return allFacilities.filter(f => club.facilities.includes(f.slug))
  }, [club, allFacilities])

  // Keep the selection valid as the club changes: the facility that was picked
  // may not exist at the new one.
  useEffect(() => {
    if (!facilities.length) { setFacility(null); return }
    setFacility(prev => (prev && facilities.some(f => f.slug === prev.slug) ? prev : facilities[0]))
  }, [facilities])

  const load = useCallback(async () => {
    if (!club || !facility) return
    setLoading(true); setError(null)
    const start = toISODate(weekStart)
    const end = toISODate(addDays(weekStart, 6))
    try {
      const r = await api(`/facility-schedule/events?club_number=${club.clubNumber}&facility=${facility.slug}&start=${start}&end=${end}`)
      setEvents(r.events || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [club, facility, weekStart])

  useEffect(() => { load() }, [load])


  async function cancelEvent() {
    if (!selected) return
    if (!window.confirm(`Remove ${selected.class_name} on ${String(selected.event_timestamp_local).slice(0, 16)}?`)) return
    setBusy(true)
    try {
      await api(`/facility-schedule/events/${encodeURIComponent(selected.event_id)}?club_number=${club.clubNumber}&facility=${facility.slug}`, { method: 'DELETE' })
      setSelected(null)
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  // Three different states used to render as "Loading..." forever. A manager
  // covering one club with a pool and one without lands on whichever club sorts
  // first; if that is the one with neither facility, there is nothing to select
  // and the screen used to hang. Say which it is.
  if (!club || !facility) {
    const message = error ? `Could not load: ${error}`
      : !clubs.length ? 'No clubs are assigned to you yet. Ask an admin to add one.'
      : !club ? 'Loading...'
      : !facilities.length ? `${club.name} does not have courts or a pool set up. Pick another club above, or turn one on in Admin - Courts & Pool.`
      : 'Loading...'
    return (
      <div className="space-y-4">
        {/* The club pills stay reachable, or a manager with a second club that
            DOES have a pool has no way to get to it. */}
        {clubs.length > 1 && (
          <div className="bg-surface rounded-xl border border-border px-3 py-2.5 flex flex-wrap items-center gap-1.5">
            {clubs.map(c => (
              <button key={c.slug} type="button" onClick={() => setClub(c)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                  club && c.slug === club.slug
                    ? 'bg-wcs-red text-white border-wcs-red font-medium'
                    : 'border-border text-text-primary hover:bg-bg'
                }`}>
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="bg-surface rounded-xl border border-border p-6 text-sm text-text-muted">
          {message}
        </div>
      </div>
    )
  }

  const gridEvents = events.map(toGridShape)

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-1.5 flex gap-1.5">
        {facilities.map(f => (
          <button key={f.slug} type="button" onClick={() => setFacility(f)}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              facility.slug === f.slug ? 'bg-wcs-red text-white font-medium' : 'text-text-primary hover:bg-bg'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {clubs.map(c => (
            <button key={c.slug} type="button" onClick={() => setClub(c)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                c.slug === club.slug
                  ? 'bg-wcs-red text-white border-wcs-red font-medium'
                  : 'border-border text-text-primary hover:bg-bg'
              }`}>
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Prev</button>
          <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">This week</button>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Next</button>
          <span className="text-sm font-medium text-text-primary ml-1">{weekLabel(weekStart)}</span>
          {loading && <span className="text-xs text-text-muted">Loading...</span>}
          <div className="ml-auto flex gap-2">
            {showBoardLinks && (
              <button type="button" onClick={() => setLinksOpen(v => !v)}
                className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
                {linksOpen ? 'Hide board links' : 'Board links'}
              </button>
            )}
            <button type="button" onClick={() => setPrintOpen(true)}
              title="Print a Monday-Sunday sheet for a chosen week"
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
              Print
            </button>
            {canEdit && (
              <button type="button" onClick={() => setCreateOpen({ date: toISODate(weekStart), time: '06:00' })}
                className="px-3 py-1.5 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover">
                Add event
              </button>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-muted">
            {facility.label} events live in the portal only, they are not sent to ABC.
            Click any empty spot on the calendar to add one at that time.
          </div>
        )}
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-red-300 p-4 text-sm text-red-900">{error}</div>
      )}

      {showBoardLinks && linksOpen && <BoardLinks clubs={clubs} facilities={facilities} />}

      <WeekGrid
        weekStart={weekStart}
        classes={gridEvents}
        onClassClick={setSelected}
        onSlotClick={canEdit ? (slot => setCreateOpen(slot)) : undefined}
      />

      {selected && canEdit && String(selected.event_timestamp_local).slice(0, 10) >= toISODate(new Date()) && (
        <EditEventModal
          club={club}
          facility={facility}
          event={selected}
          onClose={() => setSelected(null)}
          onSaved={async () => { setSelected(null); await load() }}
        />
      )}

      {selected && (!canEdit || String(selected.event_timestamp_local).slice(0, 10) < toISODate(new Date())) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-text-primary">{selected.class_name}</h3>
              <button type="button" onClick={() => setSelected(null)}
                className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-2 text-sm text-text-primary">
              {(() => {
                const p = parseLocalTimestamp(selected.event_timestamp_local)
                return <div><span className="text-text-muted">When: </span>{p ? `${p.date} at ${fmtTime12(p.hour, p.min)}` : selected.event_timestamp_local}</div>
              })()}
              <div><span className="text-text-muted">Length: </span>{selected.duration_minutes} min</div>
              <div><span className="text-text-muted">Staff: </span>{selected.instructor_name || 'Nobody assigned'}</div>
            </div>
            <div className="px-5 py-4 border-t border-border flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setSelected(null)}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Close</button>
              {canEdit && (
                <button type="button" onClick={cancelEvent} disabled={busy}
                  className="px-4 py-2 text-sm rounded-lg border border-red-300 bg-red-50 text-red-900 font-medium hover:bg-red-100 disabled:opacity-50">
                  {busy ? 'Removing...' : 'Remove'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateEventModal
          club={club}
          facility={facility}
          defaultDate={createOpen.date}
          defaultTime={createOpen.time}
          onClose={() => setCreateOpen(null)}
          onCreated={async () => { setCreateOpen(null); await load() }}
        />
      )}

      {printOpen && (
        <PrintBoardModal club={club} facility={facility} onClose={() => setPrintOpen(false)} />
      )}

    </div>
  )
}
