import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import { fmtTime12, parseLocalTimestamp } from '../../lib/weekGrid'
import AttendanceModal from './AttendanceModal'
import GroupXReport from './GroupXReport'

// Group X Attendance: log how many people actually came, and look back at what
// was logged.
//
// Split out of the scheduler because they are two different jobs done by two
// different people at two different moments. Scheduling is planning work done
// ahead of time; this is a queue you work through after the fact, the same
// shape as the Tour Check-In queue -- a list of things that already happened,
// each one a tap away from being recorded.
//
// Headcounts are staff-entered rather than read from ABC on purpose: of 37
// Salem class events in July 2026, 31 had no members attached at all and the
// rest had one, marked "Did Not Attend". Nobody books classes through ABC, so
// its attendance data cannot be used.

// How far back the queue looks for classes still missing a count. A week is
// enough to catch up after a missed shift without the list becoming an
// infinite backlog nobody ever clears.
const LOOKBACK_DAYS = 7

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayIso() {
  return isoDaysAgo(0)
}

// "Tue, Aug 26" — the queue is a flat list across several days, so each row has
// to say its own date. A bare time would be ambiguous.
function fmtDay(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function ClassRow({ c, onClick }) {
  const p = parseLocalTimestamp(c.event_timestamp_local)
  const logged = c.headcount != null
  return (
    <button
      type="button"
      onClick={() => onClick(c)}
      className="w-full text-left py-2.5 px-2 flex flex-wrap items-baseline gap-x-2 hover:bg-bg rounded transition"
    >
      <span className="text-sm font-medium text-text-primary">{c.class_name}</span>
      <span className="text-xs text-text-muted">
        {p ? `${fmtDay(p.date)} at ${fmtTime12(p.hour, p.min)}` : c.event_timestamp_local}
        {c.instructor_name ? ` · ${c.instructor_name}` : ''}
      </span>
      {logged ? (
        <span className="ml-auto flex items-baseline gap-2">
          {/* The number IS the status. A green tick beside it would say the
              same thing twice and push the count off small screens. */}
          <span className="text-sm font-bold tabular-nums text-text-primary">{c.headcount}</span>
          <span className="text-[10px] uppercase tracking-wide text-text-muted">
            {c.max_attendees ? `of ${c.max_attendees}` : 'logged'}
          </span>
        </span>
      ) : (
        <span className="ml-auto text-xs text-wcs-red font-medium">Add count</span>
      )}
    </button>
  )
}

export default function GroupXAttendanceView() {
  const [clubs, setClubs] = useState([])
  const [club, setClub] = useState(null)
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('log')
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
    try {
      const r = await api(
        `/group-x/classes?club_number=${club.clubNumber}&start=${isoDaysAgo(LOOKBACK_DAYS)}&end=${todayIso()}`
      )
      setClasses(r.classes || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [club])

  useEffect(() => { load() }, [load])

  // Only classes that have actually finished. A class still to come today is
  // not something anyone can count yet, and listing it invites a guess.
  // needs_attendance is the server's own "past and unlogged" flag, so a row is
  // countable when it either needs a count or already has one.
  const past = classes
    .filter(c => c.needs_attendance || c.headcount != null)
    .sort((a, b) => String(b.event_timestamp_local).localeCompare(String(a.event_timestamp_local)))

  const pending = past.filter(c => c.headcount == null)
  const logged = past.filter(c => c.headcount != null)

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
        {[['log', 'Log'], ['history', 'History']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              tab === key ? 'bg-wcs-red text-white font-medium' : 'text-text-primary hover:bg-bg'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'history' && <GroupXReport clubs={clubs} />}

      {tab === 'log' && (<>
        <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {clubs.map(c => (
              <button
                key={c.slug}
                type="button"
                onClick={() => setClub(c)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                  club.slug === c.slug
                    ? 'bg-wcs-red text-white border-wcs-red font-medium'
                    : 'border-border text-text-primary hover:bg-bg'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted">
            Classes from the last {LOOKBACK_DAYS} days at {club.name}. Tap one to record how many came.
          </p>
        </div>

        {error && (
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">
              {error}
            </div>
          </div>
        )}

        {loading && (
          <div className="bg-surface rounded-xl border border-border p-6 text-sm text-text-muted">
            Loading classes...
          </div>
        )}

        {!loading && pending.length > 0 && (
          <div className="bg-surface rounded-xl border border-border p-4">
            <h3 className="font-semibold text-text-primary mb-2">
              {pending.length} {pending.length === 1 ? 'class needs' : 'classes need'} a count
            </h3>
            <div className="divide-y divide-border">
              {pending.map(c => <ClassRow key={c.event_id} c={c} onClick={setAttendanceFor} />)}
            </div>
          </div>
        )}

        {!loading && logged.length > 0 && (
          <div className="bg-surface rounded-xl border border-border p-4">
            <h3 className="font-semibold text-text-primary mb-2">
              Recorded in the last {LOOKBACK_DAYS} days
            </h3>
            {/* Still tappable: a miscounted class is corrected by opening it
                again, and the modal already loads the existing number. */}
            <div className="divide-y divide-border">
              {logged.map(c => <ClassRow key={c.event_id} c={c} onClick={setAttendanceFor} />)}
            </div>
          </div>
        )}

        {!loading && !error && past.length === 0 && (
          <div className="bg-surface rounded-xl border border-border p-6 text-sm text-text-muted">
            No classes have finished at {club.name} in the last {LOOKBACK_DAYS} days.
          </div>
        )}
      </>)}

      {attendanceFor && (
        <AttendanceModal
          club={club}
          classEvent={attendanceFor}
          onClose={() => setAttendanceFor(null)}
          onSaved={() => { setAttendanceFor(null); load() }}
        />
      )}
    </div>
  )
}
