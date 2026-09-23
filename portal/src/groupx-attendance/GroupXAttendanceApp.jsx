import { useState, useEffect, useCallback } from 'react'
import { publicGroupXAttendance } from '../lib/api'
import { ClassRow } from '../components/groupx/GroupXAttendanceView'
import AttendanceModal from '../components/groupx/AttendanceModal'

// Login-free Group X attendance for one club, opened from its secret link
// (/groupx.html?token=...). The same queue and the same "How many came?" modal
// as the portal's Attendance tile, notes included, minus the club picker: the
// token already picks the club.

// A tablet left open on this page should not show a stale list the next
// morning, so re-read now and then. The ABC calendar is cached server-side.
const REFRESH_MS = 5 * 60 * 1000

function Card({ children, tone }) {
  const color = tone === 'error' ? 'text-wcs-red' : 'text-text-muted'
  return <p className={`${color} text-sm bg-surface border border-border rounded-xl px-4 py-8 text-center`}>{children}</p>
}

export default function GroupXAttendanceApp({ token }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [attendanceFor, setAttendanceFor] = useState(null)

  const load = useCallback(async () => {
    if (!token) {
      setError('This link is missing its access code. Ask a manager for the attendance link.')
      setLoading(false)
      return
    }
    try {
      setData(await publicGroupXAttendance.get(token))
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const classes = [...(data?.classes || [])]
    .sort((a, b) => String(b.event_timestamp_local).localeCompare(String(a.event_timestamp_local)))
  const pending = classes.filter(c => c.headcount == null)
  const logged = classes.filter(c => c.headcount != null)
  const days = data?.lookback_days || 7

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-surface rounded-xl border border-border px-4 py-3 flex flex-wrap items-center gap-3">
          <img src="/wcs-logo.png" alt="" className="w-8 h-8" />
          <div>
            <h1 className="font-semibold text-text-primary leading-tight">Group X Attendance</h1>
            {data?.club && <p className="text-sm text-text-muted leading-tight">{data.club}</p>}
          </div>
          {data && (
            <span className="ml-auto text-sm text-text-muted">
              {pending.length > 0
                ? `${pending.length} of ${classes.length} still need a count`
                : `All ${classes.length} logged`}
              <span> · last {days} days</span>
            </span>
          )}
        </div>

        {loading && <Card>Loading classes…</Card>}
        {!loading && error && <Card tone="error">{error}</Card>}

        {!loading && !error && classes.length === 0 && (
          <Card>No classes have finished in the last {days} days.</Card>
        )}

        {!loading && pending.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted px-1">Needs a count</h2>
            {pending.map(c => <ClassRow key={c.event_id} c={c} onClick={setAttendanceFor} />)}
          </div>
        )}

        {!loading && logged.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted px-1">Recorded</h2>
            {logged.map(c => <ClassRow key={c.event_id} c={c} onClick={setAttendanceFor} />)}
          </div>
        )}
      </div>

      {attendanceFor && (
        <AttendanceModal
          classEvent={attendanceFor}
          onSave={(n, notes) => publicGroupXAttendance.save(token, attendanceFor.event_id, n, notes)}
          onClose={() => setAttendanceFor(null)}
          onSaved={() => { setAttendanceFor(null); load() }}
        />
      )}
    </div>
  )
}
