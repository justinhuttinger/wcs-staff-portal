import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import { fmtTime12, parseLocalTimestamp, displayClassName } from '../../lib/weekGrid'
import AttendanceModal from './AttendanceModal'
import GroupXReport from './GroupXReport'

// Group X Attendance: log how many people actually came, and look back at what
// was logged.
//
// Split out of the scheduler because they are two different jobs done by two
// different people at two different moments. Scheduling is planning work done
// ahead of time; this is a queue you work through after the fact, so it is
// built to match the Tour Check-In queue exactly -- one card per row, avatar,
// detail, status pill on the right -- because staff already know how to work
// that screen and there is no reason for a second visual language.
//
// Headcounts are staff-entered rather than read from ABC on purpose: of 37
// Salem class events in July 2026, 31 had no members attached at all and the
// rest had one, marked "Did Not Attend". Nobody books classes through ABC, so
// its attendance data cannot be used.

// How far back the queue looks. A week is enough to catch up after a missed
// shift without the list becoming an infinite backlog nobody ever clears.
const LOOKBACK_DAYS = 7

function isoDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// "Tue, Aug 26". The queue is a flat list spanning several days, so every row
// has to carry its own date -- a bare time would be ambiguous.
function fmtDay(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function timeAgo(iso) {
  if (!iso) return ''
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}

// Avatar treatment lifted from TourCheckinQueueView so the two queues look like
// one product. Keyed on the INSTRUCTOR, since that is the person in the row.
function initials(name) {
  const p = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  if (p.length === 1) return p[0][0].toUpperCase()
  return (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = [
  'bg-red-100 text-red-700', 'bg-blue-100 text-blue-700', 'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700', 'bg-amber-100 text-amber-700', 'bg-teal-100 text-teal-700',
]

function avatarColor(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length
  return AVATAR_COLORS[h]
}

function Avatar({ name }) {
  return (
    <div className={`w-14 h-14 shrink-0 rounded-full flex items-center justify-center font-bold text-lg ${avatarColor(name)}`}>
      {initials(name)}
    </div>
  )
}

function Card({ children, tone }) {
  const color = tone === 'error' ? 'text-wcs-red' : 'text-text-muted'
  return <p className={`${color} text-sm bg-surface/95 border border-border rounded-xl px-4 py-8 text-center`}>{children}</p>
}

// One class, one row. Same card geometry as a tour check-in: avatar, the thing
// itself, then a status pill hard right.
function ClassRow({ c, onClick }) {
  const p = parseLocalTimestamp(c.event_timestamp_local)
  const logged = c.headcount != null
  const name = displayClassName(c.class_name, c.duration_minutes)
  const when = p ? `${fmtDay(p.date)} · ${fmtTime12(p.hour, p.min)}` : c.event_timestamp_local
  // Fill only reads as a rate when there is a capacity to divide by.
  const fill = logged && c.max_attendees > 0
    ? Math.round((c.headcount / c.max_attendees) * 100)
    : null

  return (
    <button
      type="button"
      onClick={() => onClick(c)}
      className="w-full text-left bg-surface border border-border rounded-2xl p-5 flex items-center gap-5 transition-all hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
    >
      <Avatar name={c.instructor_name} />

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-lg text-text-primary truncate">{name}</p>
        <p className="text-sm text-text-muted truncate">{when}</p>
        <p className="text-sm text-text-muted truncate">{c.instructor_name || 'Unassigned'}</p>
      </div>

      <div className="shrink-0 text-right">
        {logged ? (
          <>
            {/* The number IS the status, so it gets the emphasis and the pill
                stays quiet. A separate "logged" tick would say it twice. */}
            <span className="inline-flex items-baseline gap-1.5 px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
              <span className="text-base font-bold tabular-nums leading-none">{c.headcount}</span>
              <span className="text-xs font-semibold">
                {c.max_attendees ? `of ${c.max_attendees}` : 'in'}
              </span>
            </span>
            <p className="text-xs text-text-muted mt-1">
              {fill !== null ? `${fill}% full` : 'Recorded'}
              {c.recorded_at ? ` · ${timeAgo(c.recorded_at)}` : ''}
            </p>
          </>
        ) : (
          <>
            <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-red-50 text-wcs-red border border-red-200">
              Needs a count
            </span>
            <p className="text-xs text-text-muted mt-1">Tap to record</p>
          </>
        )}
      </div>
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
        `/group-x/classes?club_number=${club.clubNumber}&start=${isoDaysAgo(LOOKBACK_DAYS)}&end=${isoDaysAgo(0)}`
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
        {/* Club picker and the count of outstanding work, on one line. The
            number is the reason to be on this screen, so it is stated up front
            rather than left to be counted off the list. */}
        <div className="bg-surface rounded-xl border border-border p-4 flex flex-wrap items-center gap-3">
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
          {!loading && (
            <span className="ml-auto text-sm text-text-muted">
              {pending.length > 0
                ? `${pending.length} of ${past.length} still need a count`
                : `All ${past.length} logged`}
              <span className="text-text-muted"> · last {LOOKBACK_DAYS} days</span>
            </span>
          )}
        </div>

        {error && <Card tone="error">{error}</Card>}
        {loading && <Card>Loading classes…</Card>}

        {!loading && !error && past.length === 0 && (
          <Card>No classes have finished at {club.name} in the last {LOOKBACK_DAYS} days.</Card>
        )}

        {!loading && pending.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted px-1">
              Needs a count
            </h3>
            {pending.map(c => <ClassRow key={c.event_id} c={c} onClick={setAttendanceFor} />)}
          </div>
        )}

        {!loading && logged.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted px-1">
              Recorded
            </h3>
            {/* Still tappable: a miscounted class is corrected by opening it
                again, and the modal already loads the existing number. */}
            {logged.map(c => <ClassRow key={c.event_id} c={c} onClick={setAttendanceFor} />)}
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
