import { useEffect, useMemo, useState } from 'react'
import { coachingApi } from './coachingApi'
import { groupSets, compareToLast, signed } from './logs'
import { Card, prettyDay } from './ui.jsx'

const fmt = (v) => (v == null || v === '' ? '-' : String(Number(v)))
const duration = (s) => (s ? `${Math.round(s / 60)} min` : null)

// Every session the client logged, set by set, with each exercise's top set
// against the last time they did it.
export default function ClientLogs({ member }) {
  const [sessions, setSessions] = useState(null)
  const [limit, setLimit] = useState(20)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    coachingApi.listSessions(member, limit)
      .then(r => { if (live) setSessions(r.sessions || []) })
      .catch(err => { if (live) setError(err.message) })
    return () => { live = false }
  }, [member, limit])

  const deltas = useMemo(() => compareToLast(sessions || []), [sessions])

  if (sessions === null) {
    return <Card bodyClass="p-5"><p className={`text-sm ${error ? 'text-wcs-red' : 'text-text-muted'}`}>{error || 'Loading workouts…'}</p></Card>
  }
  if (!sessions.length) {
    return <Card bodyClass="p-6 text-center"><p className="text-sm text-text-muted">No workouts logged yet. They show up here as soon as {member.first_name || 'the client'} logs a set in the app.</p></Card>
  }

  return (
    <div className="space-y-3">
      {sessions.map(s => {
        const groups = groupSets(s.sets)
        const vs = deltas.get(s.id) || new Map()
        return (
          <Card
            key={s.id}
            title={`${prettyDay(s.performed_on)} · ${s.day_name || 'Workout'}`}
            hint={[
              `${s.sets.length} set${s.sets.length === 1 ? '' : 's'}`,
              duration(s.duration_seconds),
              s.completed_at ? null : 'not finished',
              s.logged_by ? `logged by ${s.logged_by}` : null,
            ].filter(Boolean).join(' · ')}
          >
            {s.notes ? <p className="px-4 pt-3 text-sm text-text-primary">“{s.notes}”</p> : null}
            {groups.length ? (
              <ul className="divide-y divide-border">
                {groups.map(g => {
                  const d = g.exercise_id ? vs.get(g.exercise_id) : null
                  return (
                    <li key={g.exercise_id || g.name} className="px-4 py-3 grid gap-2 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_minmax(0,180px)] md:items-start">
                      <span className="text-sm font-semibold text-text-primary">{g.name}</span>
                      <span className="flex flex-wrap gap-1.5">
                        {g.sets.map(set => (
                          <span key={`${set.set_number}-${set.program_item_id || set.extra_position}`} className="px-2 py-1 rounded-md bg-bg border border-border text-xs text-text-primary" title={set.note || ''}>
                            {fmt(set.weight)} × {fmt(set.reps)}{set.rir != null ? <span className="text-text-muted"> @{fmt(set.rir)}</span> : null}
                          </span>
                        ))}
                      </span>
                      <span className="text-xs text-text-muted">
                        {d ? (
                          <>
                            vs {prettyDay(d.performed_on)}: {fmt(d.weight)} × {fmt(d.reps)}
                            {d.dWeight != null && d.dWeight !== 0 ? <span className={d.dWeight > 0 ? 'text-green-700 font-semibold' : 'text-wcs-red font-semibold'}> {signed(d.dWeight)}</span> : null}
                            {d.dWeight === 0 && d.dReps ? <span className={d.dReps > 0 ? 'text-green-700 font-semibold' : 'text-wcs-red font-semibold'}> {signed(d.dReps)} reps</span> : null}
                          </>
                        ) : 'First time logged'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : <p className="px-4 py-3 text-sm text-text-muted">No sets logged.</p>}
          </Card>
        )
      })}
      {sessions.length >= limit && limit < 100 ? (
        <div className="text-center">
          <button onClick={() => setLimit(l => Math.min(100, l + 30))} className="px-4 py-2 rounded-lg border border-border bg-surface text-sm font-semibold">Show older workouts</button>
        </div>
      ) : null}
    </div>
  )
}
