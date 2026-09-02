import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import { startOfWeekMonday, addDays, toISODate, fmtTime12, parseLocalTimestamp, MONTH_LABELS } from '../../lib/weekGrid'
import WeekGrid from './WeekGrid'
import CreateClassModal from './CreateClassModal'
import SeriesList from './SeriesList'
import PrintBoardModal from '../schedule/PrintBoardModal'

function weekLabel(weekStart) {
  const end = addDays(weekStart, 6)
  const a = `${MONTH_LABELS[weekStart.getMonth()]} ${weekStart.getDate()}`
  const b = weekStart.getMonth() === end.getMonth()
    ? `${end.getDate()}`
    : `${MONTH_LABELS[end.getMonth()]} ${end.getDate()}`
  return `${a} - ${b}, ${end.getFullYear()}`
}

// `canEdit` splits the two audiences this screen serves. Front desk gets a
// read-and-print view of the calendar; lead and above get the write controls.
// It defaults to FALSE: a caller that forgets to pass it should hand out the
// read-only screen, not the one with a Cancel class button on it.
//
// Board links used to live here behind a flag. They are an admin concern --
// handed out once when a TV is set up -- and now live only in Admin -> Group X.
export default function GroupXView({ canEdit = false }) {
  const [clubs, setClubs] = useState([])
  // Distinguishes "not fetched yet" from "fetched, and there are none".
  const [loadedClubs, setLoadedClubs] = useState(false)
  const [club, setClub] = useState(null)
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(new Date()))
  const [classes, setClasses] = useState([])
  const [classTypes, setClassTypes] = useState([])
  const [instructors, setInstructors] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  // null when closed; otherwise { date, time } prefilled from the clicked slot
  // or from the toolbar button.
  const [createOpen, setCreateOpen] = useState(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [badgeBusy, setBadgeBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [seriesListOpen, setSeriesListOpen] = useState(false)

  useEffect(() => {
    api('/group-x/clubs')
      .then(r => {
        setClubs(r.clubs || [])
        setClub((r.clubs || [])[0] || null)
        setLoadedClubs(true)
      })
      .catch(e => { setError(e.message); setLoadedClubs(true) })
  }, [])

  const load = useCallback(async () => {
    if (!club) return
    setLoading(true)
    setError(null)
    const start = toISODate(weekStart)
    const end = toISODate(addDays(weekStart, 6))
    try {
      const [cls, types, staff] = await Promise.all([
        api(`/group-x/classes?club_number=${club.clubNumber}&start=${start}&end=${end}`),
        api(`/group-x/class-types?club_number=${club.clubNumber}`),
        api(`/group-x/instructors?club_number=${club.clubNumber}`),
      ])
      setClasses(cls.classes || [])
      setClassTypes(types.class_types || [])
      setInstructors(staff.instructors || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [club, weekStart])

  useEffect(() => { load() }, [load])

  // Badge or unbadge one already-scheduled class. This is the "we added a
  // Saturday Yoga and Friday Yoga is not new" case, which a class-type badge
  // cannot express.
  async function toggleSessionBadge() {
    if (!selected) return
    setBadgeBusy(true)
    setError(null)
    try {
      if (selected.is_new && selected.new_source === 'session') {
        await api(`/group-x/new-classes/events/${encodeURIComponent(selected.event_id)}?club_number=${club.clubNumber}`, { method: 'DELETE' })
      } else {
        const d = new Date()
        d.setDate(d.getDate() + 30)
        const until = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        await api('/group-x/new-classes/events', {
          method: 'PUT',
          body: JSON.stringify({
            club_number: club.clubNumber,
            abc_event_id: selected.event_id,
            class_name: selected.class_name,
            show_until: until,
          }),
        })
      }
      setSelected(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBadgeBusy(false)
    }
  }

  // Instructors and class types are cached for an hour, so a newly onboarded
  // instructor would otherwise not be bookable until it expired.
  async function refreshStaff() {
    setRefreshing(true)
    setError(null)
    try {
      await api(`/group-x/refresh-staff?club_number=${club.clubNumber}`, { method: 'POST' })
      await load()
    } catch (e) { setError(e.message) } finally { setRefreshing(false) }
  }

  async function cancelClass() {
    if (!selected) return
    if (!window.confirm(`Cancel ${selected.class_name} on ${selected.event_timestamp_local.slice(0, 16)}? This removes it from the ABC calendar.`)) return
    setCancelBusy(true)
    try {
      await api(`/group-x/classes/${encodeURIComponent(selected.event_id)}?club_number=${club.clubNumber}&date=${encodeURIComponent(String(selected.event_timestamp_local).slice(0, 10))}`, { method: 'DELETE' })
      setSelected(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setCancelBusy(false)
    }
  }

  // A club list can now legitimately come back EMPTY: Group X is per-club since
  // migration 178, so a member whose only club does not run it has nothing to
  // show. That must read as an answer, not as a screen still loading.
  if (!club) {
    return (
      <div className="bg-surface rounded-xl border border-border p-6 text-sm text-text-muted">
        {error ? `Could not load clubs: ${error}`
          : loadedClubs && !clubs.length ? 'Group X is not set up at your club. An admin can turn it on in Admin - Group X - Clubs.'
          : 'Loading...'}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* One assigned club is a label, not a choice. A lone pill invites a
            click that changes nothing and reads as a disabled control. */}
        {clubs.length === 1 ? (
          <span className="text-sm font-semibold text-text-primary">{club.name}</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
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

        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && (
            <button type="button" onClick={() => setSeriesListOpen(v => !v)}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
              {seriesListOpen ? 'Hide repeating' : 'Repeating'}
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={refreshStaff} disabled={refreshing}
              title="Reload instructors and class types from ABC"
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg disabled:opacity-50">
              {refreshing ? 'Refreshing...' : 'Refresh staff'}
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
              Add class
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-red-300 p-4 text-sm text-red-900">
          {error}
        </div>
      )}

      {canEdit && seriesListOpen && <SeriesList club={club} onChanged={load} />}



      <WeekGrid
        weekStart={weekStart}
        classes={classes}
        weekLabel={weekLabel(weekStart)}
        loading={loading}
        onPrevWeek={() => setWeekStart(addDays(weekStart, -7))}
        onNextWeek={() => setWeekStart(addDays(weekStart, 7))}
        onThisWeek={() => setWeekStart(startOfWeekMonday(new Date()))}
        onClassClick={setSelected}
        onSlotClick={canEdit ? (slot => setCreateOpen(slot)) : undefined}
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
              <div><span className="text-text-muted">Instructor: </span>{selected.instructor_name || 'Unassigned'}</div>
              <div><span className="text-text-muted">Status: </span>{selected.status || 'Unknown'}</div>
              {selected.max_attendees != null && (
                <div><span className="text-text-muted">Capacity: </span>{selected.max_attendees}</div>
              )}
              {selected.is_new && (
                <div>
                  <span className="text-text-muted">Badge: </span>
                  New class
                  <span className="text-text-muted">
                    {selected.new_source === 'session' ? ' (this class only)' : ' (whole class type)'}
                  </span>
                </div>
              )}
              {selected.headcount != null && (
                <div>
                  <span className="text-text-muted">Attended: </span>
                  {selected.headcount}
                  {selected.max_attendees > 0 && ` (${Math.round((selected.headcount / selected.max_attendees) * 100)}% full)`}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
              <button type="button" onClick={() => setSelected(null)}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
                Close
              </button>
              {canEdit && (<>
              <button type="button" onClick={toggleSessionBadge}
                disabled={badgeBusy || (selected.is_new && selected.new_source === 'class')}
                title={selected.is_new && selected.new_source === 'class'
                  ? 'This badge comes from the whole class type. Remove it under New badges.'
                  : undefined}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg font-medium disabled:opacity-50">
                {badgeBusy
                  ? 'Saving...'
                  : selected.is_new && selected.new_source === 'session' ? 'Remove New badge' : 'Mark as new'}
              </button>
              <button type="button" onClick={cancelClass} disabled={cancelBusy}
                className="px-4 py-2 text-sm rounded-lg border border-red-300 bg-red-50 text-red-900 font-medium hover:bg-red-100 disabled:opacity-50">
                {cancelBusy ? 'Cancelling...' : 'Cancel class'}
              </button>
              </>)}
            </div>
          </div>
        </div>
      )}


      {createOpen && (
        <CreateClassModal
          club={club}
          classTypes={classTypes}
          instructors={instructors}
          defaultDate={createOpen.date}
          defaultTime={createOpen.time}
          onClose={() => setCreateOpen(null)}
          onCreated={async () => { setCreateOpen(null); await load() }}
        />
      )}

      {printOpen && (
        <PrintBoardModal club={club} onClose={() => setPrintOpen(false)} />
      )}
    </div>
  )
}
