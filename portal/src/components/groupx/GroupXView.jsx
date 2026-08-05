import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import { startOfWeek, addDays, toISODate, fmtTime12, parseLocalTimestamp, MONTH_LABELS } from '../../lib/weekGrid'
import WeekGrid from './WeekGrid'
import CreateClassModal from './CreateClassModal'
import BoardLinks from './BoardLinks'
import GroupXReport from './GroupXReport'
import NewClassBadges from './NewClassBadges'
import SeriesList from './SeriesList'
import AttendanceModal from './AttendanceModal'
import PrintScheduleModal from '../schedule/PrintScheduleModal'

function weekLabel(weekStart) {
  const end = addDays(weekStart, 6)
  const a = `${MONTH_LABELS[weekStart.getMonth()]} ${weekStart.getDate()}`
  const b = weekStart.getMonth() === end.getMonth()
    ? `${end.getDate()}`
    : `${MONTH_LABELS[end.getMonth()]} ${end.getDate()}`
  return `${a} - ${b}, ${end.getFullYear()}`
}

export default function GroupXView() {
  const [clubs, setClubs] = useState([])
  const [club, setClub] = useState(null)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
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
  const [linksOpen, setLinksOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [badgesOpen, setBadgesOpen] = useState(false)
  const [badgeBusy, setBadgeBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [seriesListOpen, setSeriesListOpen] = useState(false)
  const [tab, setTab] = useState('calendar')
  const [attendanceFor, setAttendanceFor] = useState(null)

  useEffect(() => {
    api('/group-x/clubs')
      .then(r => { setClubs(r.clubs); setClub(r.clubs[0]) })
      .catch(e => setError(e.message))
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

  // The print sheet picks its own week, which is usually not the one on screen
  // (the point is to run off next week's sheet ahead of time), so it fetches
  // its own range rather than reusing `classes`.
  const fetchPrintWeek = useCallback(async (start, end) => {
    const r = await api(`/group-x/classes?club_number=${club.clubNumber}&start=${start}&end=${end}`)
    return r.classes || []
  }, [club])

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

  if (!club) {
    return (
      <div className="bg-surface rounded-xl border border-border p-6 text-sm text-text-muted">
        {error ? `Could not load clubs: ${error}` : 'Loading...'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-1.5 flex gap-1.5">
        {['calendar', 'performance'].map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-lg capitalize transition ${
              tab === t ? 'bg-wcs-red text-white font-medium' : 'text-text-primary hover:bg-bg'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'performance' && <GroupXReport clubs={clubs} />}

      {tab === 'calendar' && (<>
      <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
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

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
            Prev
          </button>
          <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
            This week
          </button>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
            Next
          </button>
          <span className="text-sm font-medium text-text-primary ml-1">{weekLabel(weekStart)}</span>
          {loading && <span className="text-xs text-text-muted">Loading...</span>}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setSeriesListOpen(v => !v)}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
              {seriesListOpen ? 'Hide repeating' : 'Repeating'}
            </button>
            <button type="button" onClick={refreshStaff} disabled={refreshing}
              title="Reload instructors and class types from ABC"
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg disabled:opacity-50">
              {refreshing ? 'Refreshing...' : 'Refresh staff'}
            </button>
            <button type="button" onClick={() => setBadgesOpen(v => !v)}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
              {badgesOpen ? 'Hide new badges' : 'New badges'}
            </button>
            <button type="button" onClick={() => setLinksOpen(v => !v)}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
              {linksOpen ? 'Hide board links' : 'Board links'}
            </button>
            <button type="button" onClick={() => setPrintOpen(true)}
              title="Print a Monday-Sunday sheet for a chosen week"
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
              Print
            </button>
            <button type="button" onClick={() => setCreateOpen({ date: toISODate(weekStart), time: '06:00' })}
              className="px-3 py-1.5 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover">
              Add class
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Classes created or cancelled here are written straight to the live ABC calendar.
          Click any empty spot on the calendar to add a class at that time.
        </div>
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-red-300 p-4 text-sm text-red-900">
          {error}
        </div>
      )}

      {seriesListOpen && <SeriesList club={club} onChanged={load} />}

      {badgesOpen && <NewClassBadges club={club} classTypes={classTypes} />}

      {linksOpen && <BoardLinks clubs={clubs} />}

      {(() => {
        const pending = classes.filter(c => c.needs_attendance)
        // Nothing to chase means nothing rendered. We never show a card saying
        // everything is logged.
        if (pending.length === 0) return null
        return (
          <div className="bg-surface rounded-xl border border-border p-4">
            <h3 className="font-semibold text-text-primary mb-2">
              {pending.length} {pending.length === 1 ? 'class needs' : 'classes need'} an attendance count
            </h3>
            <div className="divide-y divide-border">
              {pending.map(c => {
                const p = parseLocalTimestamp(c.event_timestamp_local)
                return (
                  <button key={c.event_id} type="button" onClick={() => setAttendanceFor(c)}
                    className="w-full text-left py-2 flex flex-wrap items-baseline gap-x-2 hover:bg-bg rounded px-1">
                    <span className="text-sm font-medium text-text-primary">{c.class_name}</span>
                    <span className="text-xs text-text-muted">
                      {p ? `${p.date} at ${fmtTime12(p.hour, p.min)}` : c.event_timestamp_local}
                      {c.instructor_name ? ` · ${c.instructor_name}` : ''}
                    </span>
                    <span className="ml-auto text-xs text-wcs-red font-medium">Add count</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      <WeekGrid
        weekStart={weekStart}
        classes={classes}
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
              <button type="button" onClick={() => { setAttendanceFor(selected); setSelected(null) }}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg font-medium">
                {selected.headcount != null ? 'Edit count' : 'Add count'}
              </button>
              <button type="button" onClick={cancelClass} disabled={cancelBusy}
                className="px-4 py-2 text-sm rounded-lg border border-red-300 bg-red-50 text-red-900 font-medium hover:bg-red-100 disabled:opacity-50">
                {cancelBusy ? 'Cancelling...' : 'Cancel class'}
              </button>
            </div>
          </div>
        </div>
      )}

      </>)}

      {attendanceFor && (
        <AttendanceModal
          club={club}
          classEvent={attendanceFor}
          onClose={() => setAttendanceFor(null)}
          onSaved={async () => { setAttendanceFor(null); await load() }}
        />
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
        <PrintScheduleModal
          title="Class Schedule"
          clubName={club.name}
          fetchWeek={fetchPrintWeek}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  )
}
