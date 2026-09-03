import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import MobileHeader from './MobileHeader'

// Running a member through a workout from the floor. Writes the same rows the
// member app writes, keyed to the member, so their history is identical
// whether they logged it or the trainer did.

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// `sets` is a coach's free text, so "4" and "3 sets" both have to yield a row
// count; anything unreadable falls back to one, capped so a typo cannot
// render hundreds.
function setCount(sets) {
  const m = String(sets ?? '').match(/\d+/)
  const n = m ? Number(m[0]) : 1
  return Number.isFinite(n) && n >= 1 ? Math.min(12, n) : 1
}
const hint = (t) => (String(t ?? '').match(/\d+(\.\d+)?/) || [null])[0]

function Rest({ seconds, onDone }) {
  const [left, setLeft] = useState(seconds)
  const endAt = useRef(Date.now() + seconds * 1000)

  useEffect(() => {
    const id = setInterval(() => {
      // Off a target timestamp, not a tick counter: a backgrounded phone
      // throttles intervals and would stretch the rest.
      const remaining = Math.max(0, Math.round((endAt.current - Date.now()) / 1000))
      setLeft(remaining)
      if (remaining === 0) { clearInterval(id); navigator.vibrate?.(400) }
    }, 250)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex items-center gap-3 mt-2 px-3 py-2 rounded-lg bg-bg border border-border">
      <span className="text-xl font-bold tabular-nums">{mmss(left)}</span>
      <span className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
        <span
          className="block h-full bg-wcs-red rounded-full transition-all"
          style={{ width: `${seconds ? ((seconds - left) / seconds) * 100 : 100}%` }}
        />
      </span>
      <button onClick={onDone} className="text-xs font-bold uppercase tracking-wider text-wcs-red">
        {left === 0 ? 'Next' : 'Skip'}
      </button>
    </div>
  )
}

function Exercise({ exercise, sessionId, onSaved }) {
  const [sets, setSets] = useState(
    () => Array.from({ length: setCount(exercise.sets) }, () => ({ reps: '', weight: '' })),
  )
  const [saved, setSaved] = useState({})
  const [busy, setBusy] = useState(null)
  const [resting, setResting] = useState(null)
  const [error, setError] = useState(null)

  async function log(i) {
    setBusy(i); setError(null)
    try {
      await api(`/member-app/sessions/${sessionId}/sets`, {
        method: 'POST',
        body: JSON.stringify({
          exercise_id: exercise.id, set_number: i + 1,
          reps: sets[i].reps, weight: sets[i].weight,
        }),
      })
      setSaved(s => ({ ...s, [i]: true }))
      onSaved?.()
      if (exercise.rest_seconds > 0) setResting(i)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const patch = (i, p) => setSets(l => l.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const field = 'w-full px-2 py-2 rounded border border-border bg-bg text-center text-base'

  return (
    <div className="border border-border rounded-xl bg-surface p-3 mb-3">
      <div className="flex items-center gap-2">
        <p className="flex-1 font-bold">{exercise.name}</p>
        {sets.every((_, i) => saved[i]) ? <span className="text-green-700 font-bold">✓</span> : null}
      </div>
      <p className="text-xs text-text-muted mb-2">
        {[exercise.sets && `${exercise.sets} sets`, exercise.reps && `${exercise.reps} reps`,
          exercise.weight, exercise.rest_seconds > 0 && `${exercise.rest_seconds}s rest`]
          .filter(Boolean).join(' · ') || 'As prescribed'}
      </p>
      {exercise.notes ? <p className="text-xs text-text-muted mb-2">{exercise.notes}</p> : null}

      {sets.map((s, i) => (
        <div key={i} className="grid grid-cols-[24px_1fr_1fr_auto] gap-2 items-center mb-2">
          <span className="text-text-muted text-sm text-center">{i + 1}</span>
          <input className={field} inputMode="numeric" placeholder={hint(exercise.reps) || 'reps'}
                 value={s.reps} onChange={e => { patch(i, { reps: e.target.value }); setSaved(x => ({ ...x, [i]: false })) }} />
          <input className={field} inputMode="decimal" placeholder={hint(exercise.weight) || 'lb'}
                 value={s.weight} onChange={e => { patch(i, { weight: e.target.value }); setSaved(x => ({ ...x, [i]: false })) }} />
          <button
            onClick={() => log(i)} disabled={busy === i}
            className={[
              'px-3 py-2 rounded text-xs font-bold uppercase tracking-wider',
              saved[i] ? 'bg-text-primary text-white' : 'bg-bg border border-border',
            ].join(' ')}
          >
            {busy === i ? '…' : saved[i] ? '✓' : 'Save'}
          </button>
        </div>
      ))}

      {resting !== null ? (
        <Rest key={resting} seconds={exercise.rest_seconds} onDone={() => {
          setResting(null)
          setSets(l => (l.length === resting + 1 ? [...l, { reps: '', weight: '' }] : l))
        }} />
      ) : (
        <button
          onClick={() => setSets(l => [...l, { reps: '', weight: '' }])}
          className="text-xs font-bold uppercase tracking-wider text-wcs-red"
        >
          Add a set
        </button>
      )}

      {error ? <p className="text-sm text-wcs-red mt-2">{error}</p> : null}
    </div>
  )
}

export default function MobileWorkout({ member, program, day, onBack }) {
  const [session, setSession] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [savedCount, setSavedCount] = useState(0)

  async function start() {
    setBusy(true); setError(null)
    try {
      const r = await api('/member-app/sessions', {
        method: 'POST',
        body: JSON.stringify({
          member_id: member.member_id, club_number: member.club_number,
          program_id: program.id, day_id: day.id,
        }),
      })
      setSession(r.session)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    setBusy(true)
    try {
      await api(`/member-app/sessions/${session.id}/finish`, { method: 'POST', body: JSON.stringify({}) })
      onBack()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-4 px-4 pb-8">
      <MobileHeader title={day.name} onBack={onBack} />
      <p className="text-sm text-text-muted mb-3">
        {member.first_name} {member.last_name} &middot; {program.name}
      </p>

      {error ? <p className="text-sm text-wcs-red mb-2">{error}</p> : null}

      {!session ? (
        <>
          <button
            onClick={start} disabled={busy}
            className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50 mb-4"
          >
            {busy ? 'Starting…' : 'Start this workout'}
          </button>
          <ul className="space-y-2">
            {day.exercises.map(e => (
              <li key={e.id} className="flex justify-between text-sm border-b border-border pb-2">
                <span className="font-semibold">{e.name}</span>
                <span className="text-text-muted">
                  {[e.sets, e.reps && `x ${e.reps}`, e.weight].filter(Boolean).join(' ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {savedCount > 0 ? (
            <p className="text-xs text-text-muted mb-2">{savedCount} set{savedCount === 1 ? '' : 's'} logged</p>
          ) : null}
          {day.exercises.map(e => (
            <Exercise key={e.id} exercise={e} sessionId={session.id}
                      onSaved={() => setSavedCount(n => n + 1)} />
          ))}
          <button
            onClick={finish} disabled={busy}
            className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Finish workout'}
          </button>
        </>
      )}
    </div>
  )
}
