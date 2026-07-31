import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import { startOfWeek, addDays, toISODate, fmtTime12, parseLocalTimestamp, MONTH_LABELS } from '../../lib/weekGrid'
import WeekGrid from '../groupx/WeekGrid'
import BoardLinks from './FacilityBoardLinks'
import CreateEventModal from './CreateEventModal'
import CreateSeriesModal from './CreateFacilitySeriesModal'

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

export default function FacilityView() {
  const [clubs, setClubs] = useState([])
  const [facilities, setFacilities] = useState([])
  const [club, setClub] = useState(null)
  const [facility, setFacility] = useState(null)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [createOpen, setCreateOpen] = useState(null)
  const [seriesOpen, setSeriesOpen] = useState(false)
  const [linksOpen, setLinksOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('/facility-schedule/facilities')
      .then(r => {
        setClubs(r.clubs); setClub(r.clubs[0])
        setFacilities(r.facilities); setFacility(r.facilities[0])
      })
      .catch(e => setError(e.message))
  }, [])

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

  async function cancelSeries() {
    if (!selected?.series_id) return
    if (!window.confirm('Remove every remaining event in this repeating series from today onwards?')) return
    setBusy(true)
    try {
      await api(`/facility-schedule/series/${encodeURIComponent(selected.series_id)}?club_number=${club.clubNumber}&facility=${facility.slug}`, { method: 'DELETE' })
      setSelected(null)
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (!club || !facility) {
    return (
      <div className="bg-surface rounded-xl border border-border p-6 text-sm text-text-muted">
        {error ? `Could not load: ${error}` : 'Loading...'}
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
            <button type="button" onClick={() => setLinksOpen(v => !v)}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
              {linksOpen ? 'Hide board links' : 'Board links'}
            </button>
            <button type="button" onClick={() => setSeriesOpen(true)}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
              Repeating event
            </button>
            <button type="button" onClick={() => setCreateOpen({ date: toISODate(weekStart), time: '06:00' })}
              className="px-3 py-1.5 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover">
              Add event
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-muted">
          {facility.label} events live in the portal only, they are not sent to ABC.
          Click any empty spot on the calendar to add one at that time.
        </div>
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-red-300 p-4 text-sm text-red-900">{error}</div>
      )}

      {linksOpen && <BoardLinks clubs={clubs} facilities={facilities} />}

      <WeekGrid
        weekStart={weekStart}
        classes={gridEvents}
        onClassClick={setSelected}
        onSlotClick={slot => setCreateOpen(slot)}
      />

      {selected && (
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
              {selected.series_id && (
                <div className="text-xs text-text-muted">Part of a repeating series.</div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-border flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setSelected(null)}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Close</button>
              {selected.series_id && (
                <button type="button" onClick={cancelSeries} disabled={busy}
                  className="px-4 py-2 text-sm rounded-lg border border-red-300 bg-red-50 text-red-900 font-medium hover:bg-red-100 disabled:opacity-50">
                  Remove series
                </button>
              )}
              <button type="button" onClick={cancelEvent} disabled={busy}
                className="px-4 py-2 text-sm rounded-lg border border-red-300 bg-red-50 text-red-900 font-medium hover:bg-red-100 disabled:opacity-50">
                {busy ? 'Removing...' : 'Remove'}
              </button>
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

      {seriesOpen && (
        <CreateSeriesModal
          club={club}
          facility={facility}
          defaultDate={toISODate(weekStart)}
          onClose={() => setSeriesOpen(false)}
          onCreated={async () => { setSeriesOpen(false); await load() }}
        />
      )}
    </div>
  )
}
