import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import MemberAppTemplates from './MemberAppTemplates.jsx'

const blankExercise = () => ({ name: '', sets: '', reps: '', weight: '', rest_seconds: '', notes: '' })
const blankDay = () => ({ name: '', exercises: [blankExercise()] })

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

export default function MemberAppPrograms({ member }) {
  const [programs, setPrograms] = useState([])
  const [editing, setEditing] = useState(null) // { id?, name, notes, days[], starts_on }
  const [browsing, setBrowsing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    if (!member) return
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
      const r = await api(`/member-app/programs/${id}`)
      setEditing({
        id: r.program.id,
        name: r.program.name,
        notes: r.program.notes || '',
        starts_on: r.program.starts_on || '',
        days: (r.days || []).map(d => ({
          name: d.name,
          exercises: d.exercises.length ? d.exercises.map(e => ({
            name: e.name, sets: e.sets || '', reps: e.reps || '',
            weight: e.weight || '', rest_seconds: e.rest_seconds ?? '',
            notes: e.notes || '',
          })) : [blankExercise()],
        })),
      })
    } catch (err) {
      setError(err.message)
    }
  }

  async function save() {
    if (!editing.name.trim()) { setError('Give the program a name'); return }
    setBusy(true); setError(null); setNotice(null)
    const payload = {
      member_id: member.member_id,
      club_number: member.club_number,
      coach_staff_id: member.coach_staff_id || null,
      name: editing.name,
      notes: editing.notes,
      starts_on: editing.starts_on || null,
      days: editing.days,
    }
    try {
      if (editing.id) {
        await api(`/member-app/programs/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await api('/member-app/programs', { method: 'POST', body: JSON.stringify(payload) })
      }
      setNotice('Program saved. The member sees it now.')
      setEditing(null)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this program? The member loses access to it.')) return
    try {
      await api(`/member-app/programs/${id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const patchDay = (i, patch) => setEditing(p => ({
    ...p, days: p.days.map((d, di) => (di === i ? { ...d, ...patch } : d)),
  }))
  const patchExercise = (di, ei, patch) => setEditing(p => ({
    ...p,
    days: p.days.map((d, i) => (i !== di ? d : {
      ...d, exercises: d.exercises.map((e, j) => (j === ei ? { ...e, ...patch } : e)),
    })),
  }))

  const field = 'px-2 py-1 rounded border border-border bg-surface text-text-primary w-full'

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
      {notice ? <p className="text-sm text-green-700">{notice}</p> : null}

      {browsing ? (
        <MemberAppTemplates
          member={member}
          onCancel={() => setBrowsing(false)}
          onAssigned={(startsOn) => {
            setBrowsing(false)
            setNotice(startsOn
              ? `Assigned. It takes over on ${startsOn}.`
              : 'Assigned. The member sees it now.')
            load()
          }}
        />
      ) : !editing ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setBrowsing(true)}
              className="px-4 py-2 rounded-lg bg-wcs-red text-white font-semibold"
            >
              Start from a template
            </button>
            <button
              onClick={() => setEditing({ name: '', notes: '', starts_on: '', days: [blankDay()] })}
              className="px-4 py-2 rounded-lg border border-border bg-surface font-semibold"
            >
              Write from scratch
            </button>
          </div>

          {programs.length === 0 ? (
            <p className="text-sm text-text-muted">No programs for this member yet.</p>
          ) : (
            <ul className="space-y-2">
              {programs.map(p => (
                <li key={p.id} className="flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-surface">
                  <div className="flex-1">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-text-muted">
                      {scheduleLabel(p)} &middot; updated {String(p.updated_at).slice(0, 10)}
                    </div>
                  </div>
                  <button onClick={() => open(p.id)} className="text-wcs-red font-semibold hover:underline">Edit</button>
                  <button onClick={() => remove(p.id)} className="text-text-muted hover:text-wcs-red">Delete</button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="block text-text-muted mb-1">Program name</span>
              <input
                className={field} value={editing.name}
                placeholder="Fall block"
                onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="block text-text-muted mb-1">Notes for the member</span>
              <input
                className={field} value={editing.notes}
                placeholder="Warm up 10 minutes before every session"
                onChange={e => setEditing(p => ({ ...p, notes: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="block text-text-muted mb-1">Starts on</span>
              <input
                type="date" className={field} value={editing.starts_on || ''}
                onChange={e => setEditing(p => ({ ...p, starts_on: e.target.value }))}
              />
              <span className="block text-xs text-text-muted mt-1">
                Empty means it is live now. A future date keeps their current program until then.
              </span>
            </label>
          </div>

          {editing.days.map((day, di) => (
            <div key={di} className="border border-border rounded-lg p-4 bg-surface space-y-3">
              <div className="flex gap-2 items-center">
                <input
                  className={field} value={day.name}
                  placeholder={`Day ${di + 1} name, e.g. Upper`}
                  onChange={e => patchDay(di, { name: e.target.value })}
                />
                <button
                  onClick={() => setEditing(p => ({ ...p, days: p.days.filter((_, i) => i !== di) }))}
                  className="text-text-muted hover:text-wcs-red text-sm whitespace-nowrap"
                >
                  Remove day
                </button>
              </div>

              <div className="space-y-2">
                {day.exercises.map((ex, ei) => (
                  <div key={ei} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_2fr_auto] items-center">
                    <input className={field} value={ex.name} placeholder="Exercise"
                           onChange={e => patchExercise(di, ei, { name: e.target.value })} />
                    <input className={field} value={ex.sets} placeholder="Sets"
                           onChange={e => patchExercise(di, ei, { sets: e.target.value })} />
                    {/* Free text on purpose: "8-10", "AMRAP", "bodyweight". */}
                    <input className={field} value={ex.reps} placeholder="Reps"
                           onChange={e => patchExercise(di, ei, { reps: e.target.value })} />
                    <input className={field} value={ex.weight} placeholder="Weight"
                           onChange={e => patchExercise(di, ei, { weight: e.target.value })} />
                    {/* Seconds, because the app counts it down. */}
                    <input className={field} value={ex.rest_seconds} inputMode="numeric" placeholder="Rest s"
                           onChange={e => patchExercise(di, ei, { rest_seconds: e.target.value })} />
                    <input className={field} value={ex.notes} placeholder="Notes"
                           onChange={e => patchExercise(di, ei, { notes: e.target.value })} />
                    <button
                      onClick={() => patchDay(di, { exercises: day.exercises.filter((_, i) => i !== ei) })}
                      className="text-text-muted hover:text-wcs-red text-sm"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => patchDay(di, { exercises: [...day.exercises, blankExercise()] })}
                className="text-sm text-wcs-red font-semibold hover:underline"
              >
                Add exercise
              </button>
            </div>
          ))}

          <div className="flex gap-3">
            <button
              onClick={() => setEditing(p => ({ ...p, days: [...p.days, blankDay()] }))}
              className="px-4 py-2 rounded-lg border border-border bg-surface font-semibold"
            >
              Add day
            </button>
            <button
              onClick={save} disabled={busy}
              className="px-4 py-2 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save program'}
            </button>
            <button onClick={() => setEditing(null)} className="px-4 py-2 text-text-muted">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
