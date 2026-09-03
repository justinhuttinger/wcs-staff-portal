import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import MobileHeader from './MobileHeader'
import MobileWorkout from './MobileWorkout'
import MobileTemplates from './MobileTemplates'

const blankExercise = () => ({ name: '', sets: '', reps: '', weight: '', rest_seconds: '', notes: '' })
const blankDay = () => ({ name: '', exercises: [blankExercise()] })

const field = 'w-full px-3 py-2 rounded-lg border border-border bg-bg text-base'

const todayKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

// A future start date means the member cannot see it yet, which is worth
// saying plainly rather than showing it as just another program.
function scheduleLabel(p) {
  if (!p.is_active) return 'Inactive'
  if (p.starts_on && p.starts_on > todayKey()) return `Scheduled for ${p.starts_on}`
  if (p.starts_on) return `Started ${p.starts_on}`
  return 'Active'
}

// Editing on a phone: one day at a time, stacked rather than the desktop grid,
// because six inputs across a 390px screen is unusable.
function Editor({ member, existing, onDone, onCancel }) {
  const [name, setName] = useState(existing?.name || '')
  const [notes, setNotes] = useState(existing?.notes || '')
  const [startsOn, setStartsOn] = useState(existing?.starts_on || '')
  const [days, setDays] = useState(existing?.days || [blankDay()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const patchDay = (i, p) => setDays(l => l.map((d, j) => (j === i ? { ...d, ...p } : d)))
  const patchEx = (di, ei, p) => setDays(l => l.map((d, i) => (i !== di ? d : {
    ...d, exercises: d.exercises.map((e, j) => (j === ei ? { ...e, ...p } : e)),
  })))

  async function save() {
    if (!name.trim()) { setError('Give the program a name'); return }
    setBusy(true); setError(null)
    const payload = {
      member_id: member.member_id, club_number: member.club_number,
      name, notes, days, starts_on: startsOn || null,
    }
    try {
      if (existing?.id) {
        await api(`/member-app/programs/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await api('/member-app/programs', { method: 'POST', body: JSON.stringify(payload) })
      }
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-4 px-4 pb-8">
      <MobileHeader title={existing?.id ? 'Edit program' : 'New program'} onBack={onCancel} />

      <label className="block text-sm mb-3">
        <span className="block text-text-muted mb-1">Program name</span>
        <input className={field} value={name} placeholder="Fall block" onChange={e => setName(e.target.value)} />
      </label>
      <label className="block text-sm mb-3">
        <span className="block text-text-muted mb-1">Notes for the member</span>
        <input className={field} value={notes} onChange={e => setNotes(e.target.value)} />
      </label>
      <label className="block text-sm mb-4">
        <span className="block text-text-muted mb-1">Starts on</span>
        <input type="date" className={field} value={startsOn} onChange={e => setStartsOn(e.target.value)} />
        <span className="block text-xs text-text-muted mt-1">
          Empty means live now. A future date keeps their current program until then.
        </span>
      </label>

      {days.map((day, di) => (
        <div key={di} className="border border-border rounded-xl bg-surface p-3 mb-3">
          <div className="flex gap-2 items-center mb-3">
            <input
              className={field} value={day.name} placeholder={`Day ${di + 1} name`}
              onChange={e => patchDay(di, { name: e.target.value })}
            />
            <button
              onClick={() => setDays(l => l.filter((_, i) => i !== di))}
              className="text-xs text-text-muted whitespace-nowrap"
            >
              Remove
            </button>
          </div>

          {day.exercises.map((ex, ei) => (
            <div key={ei} className="border-t border-border pt-3 mb-3">
              <div className="flex gap-2 items-center mb-2">
                <input
                  className={field} value={ex.name} placeholder="Exercise"
                  onChange={e => patchEx(di, ei, { name: e.target.value })}
                />
                <button
                  onClick={() => patchDay(di, { exercises: day.exercises.filter((_, i) => i !== ei) })}
                  className="text-text-muted px-1"
                  aria-label="Remove exercise"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className={field} value={ex.sets} placeholder="Sets"
                       onChange={e => patchEx(di, ei, { sets: e.target.value })} />
                {/* Free text: "8-10", "AMRAP", "bodyweight". */}
                <input className={field} value={ex.reps} placeholder="Reps"
                       onChange={e => patchEx(di, ei, { reps: e.target.value })} />
                <input className={field} value={ex.weight} placeholder="Weight"
                       onChange={e => patchEx(di, ei, { weight: e.target.value })} />
                <input className={field} value={ex.rest_seconds} inputMode="numeric" placeholder="Rest (sec)"
                       onChange={e => patchEx(di, ei, { rest_seconds: e.target.value })} />
              </div>
              <input className={`${field} mt-2`} value={ex.notes} placeholder="Notes"
                     onChange={e => patchEx(di, ei, { notes: e.target.value })} />
            </div>
          ))}

          <button
            onClick={() => patchDay(di, { exercises: [...day.exercises, blankExercise()] })}
            className="text-xs font-bold uppercase tracking-wider text-wcs-red"
          >
            Add exercise
          </button>
        </div>
      ))}

      {error ? <p className="text-sm text-wcs-red mb-2">{error}</p> : null}

      <div className="space-y-2">
        <button
          onClick={() => setDays(l => [...l, blankDay()])}
          className="w-full py-3 rounded-lg border border-border bg-surface font-semibold"
        >
          Add day
        </button>
        <button
          onClick={save} disabled={busy}
          className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save program'}
        </button>
      </div>
    </div>
  )
}

export default function MobilePrograms({ member, onBack }) {
  const [programs, setPrograms] = useState(null)
  const [detail, setDetail] = useState(null)   // full tree of the open program
  const [editing, setEditing] = useState(null)
  const [browsing, setBrowsing] = useState(false)
  const [notice, setNotice] = useState(null)
  const [running, setRunning] = useState(null) // { program, day }
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await api(
        `/member-app/programs?member_id=${encodeURIComponent(member.member_id)}` +
        `&club_number=${encodeURIComponent(member.club_number)}`
      )
      setPrograms(r.programs || [])
    } catch (err) {
      setError(err.message)
    }
  }, [member])

  useEffect(() => { load() }, [load])

  async function open(id) {
    setError(null)
    try {
      setDetail(await api(`/member-app/programs/${id}`))
    } catch (err) {
      setError(err.message)
    }
  }

  if (browsing) {
    return (
      <MobileTemplates
        member={member}
        onBack={() => setBrowsing(false)}
        onAssigned={(startsOn) => {
          setBrowsing(false)
          setNotice(startsOn ? `Assigned. It takes over on ${startsOn}.` : 'Assigned. They see it now.')
          load()
        }}
      />
    )
  }

  if (running) {
    return (
      <MobileWorkout
        member={member} program={running.program} day={running.day}
        onBack={() => setRunning(null)}
      />
    )
  }

  if (editing) {
    return (
      <Editor
        member={member} existing={editing}
        onCancel={() => setEditing(null)}
        onDone={() => { setEditing(null); setDetail(null); load() }}
      />
    )
  }

  if (detail) {
    return (
      <div className="pt-4 px-4 pb-8">
        <MobileHeader title={detail.program.name} onBack={() => setDetail(null)} />
        {detail.program.notes ? (
          <p className="text-sm text-text-muted mb-3">{detail.program.notes}</p>
        ) : null}

        <button
          onClick={() => setEditing({
            id: detail.program.id,
            name: detail.program.name,
            notes: detail.program.notes || '',
            starts_on: detail.program.starts_on || '',
            days: detail.days.map(d => ({
              name: d.name,
              exercises: d.exercises.length ? d.exercises.map(e => ({
                name: e.name, sets: e.sets || '', reps: e.reps || '',
                weight: e.weight || '', rest_seconds: e.rest_seconds ?? '', notes: e.notes || '',
              })) : [blankExercise()],
            })),
          })}
          className="w-full py-3 rounded-lg border border-border bg-surface font-semibold mb-4"
        >
          Edit program
        </button>

        {detail.days.map(d => (
          <div key={d.id} className="border border-border rounded-xl bg-surface p-4 mb-3">
            <p className="font-bold text-lg">{d.name}</p>
            <p className="text-xs text-text-muted mb-3">
              {d.exercises.length} exercise{d.exercises.length === 1 ? '' : 's'}
            </p>
            <ul className="space-y-1 mb-3">
              {d.exercises.map(e => (
                <li key={e.id} className="flex justify-between text-sm">
                  <span>{e.name}</span>
                  <span className="text-text-muted">
                    {[e.sets, e.reps && `x ${e.reps}`, e.weight].filter(Boolean).join(' ')}
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setRunning({ program: detail.program, day: d })}
              className="w-full py-2 rounded-lg bg-wcs-red text-white font-semibold"
            >
              Run this workout
            </button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="pt-4 px-4 pb-8">
      <MobileHeader title={`${member.first_name} ${member.last_name}`.trim() || 'Member'} onBack={onBack} />

      {error ? <p className="text-sm text-wcs-red mb-2">{error}</p> : null}

      {notice ? <p className="text-sm text-green-700 mb-3">{notice}</p> : null}

      <button
        onClick={() => setBrowsing(true)}
        className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold mb-2"
      >
        Start from a template
      </button>
      <button
        onClick={() => setEditing({})}
        className="w-full py-3 rounded-lg border border-border bg-surface font-semibold mb-4"
      >
        Write from scratch
      </button>

      {programs === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : programs.length === 0 ? (
        <p className="text-sm text-text-muted">No programs yet for this member.</p>
      ) : (
        <ul className="space-y-2">
          {programs.map(p => (
            <li key={p.id}>
              <button
                onClick={() => open(p.id)}
                className="w-full text-left border border-border rounded-xl px-4 py-3 bg-surface"
              >
                <span className="block font-semibold">{p.name}</span>
                <span className="block text-xs text-text-muted">
                  {scheduleLabel(p)} &middot; updated {String(p.updated_at).slice(0, 10)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
