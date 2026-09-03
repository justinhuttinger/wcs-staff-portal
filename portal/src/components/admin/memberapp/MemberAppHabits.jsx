import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'

const nf = new Intl.NumberFormat('en-US')

const field = 'px-3 py-2 rounded-lg border border-border bg-surface text-text-primary'

// Daily tiles on the member's home screen. Staff can start one for a member;
// the member can change or drop it from the app, which is the point of a habit
// rather than an assignment.
export default function MemberAppHabits({ member }) {
  const [state, setState] = useState(null)
  const [customName, setCustomName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setState(await api(
        `/member-app/habits?member_id=${encodeURIComponent(member.member_id)}` +
        `&club_number=${encodeURIComponent(member.club_number)}`
      ))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [member])

  useEffect(() => { load() }, [load])

  async function run(work) {
    setBusy(true); setError(null)
    try {
      await work()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const base = { member_id: member.member_id, club_number: member.club_number }

  const add = (kind, extra = {}) => run(() => api('/member-app/habits', {
    method: 'POST', body: JSON.stringify({ ...base, kind, ...extra }),
  }))

  const setLevel = (habit, target) => run(() => api(`/member-app/habits/${habit.id}`, {
    method: 'PUT', body: JSON.stringify({ target }),
  }))

  const remove = (habit) => run(() => api(`/member-app/habits/${habit.id}`, { method: 'DELETE' }))

  if (!state) {
    return error
      ? <p className="text-sm text-wcs-red">{error}</p>
      : <p className="text-sm text-text-muted">Loading…</p>
  }

  const tracking = new Set(state.habits.map(h => h.kind))
  const available = state.presets.filter(p => !tracking.has(p.kind))

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-wcs-red">{error}</p> : null}

      {state.habits.length === 0 ? (
        <p className="text-sm text-text-muted">
          No habits yet. Add one and it shows up on their home screen tomorrow morning.
        </p>
      ) : (
        <ul className="space-y-2">
          {state.habits.map(h => {
            const preset = state.presets.find(p => p.kind === h.kind)
            return (
              <li key={h.id} className="border border-border rounded-lg bg-surface p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold">
                      {h.label}
                      {h.target ? (
                        <span className="text-text-muted font-normal">
                          {' '}&middot; {nf.format(h.target)} {h.unit}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-text-muted">
                      {/* Adherence is the part a coach acts on, so it leads. */}
                      Hit {h.days_hit} of the last {h.window_days} days
                      {h.done_today ? ' · done today' : ''}
                      {h.assigned_by ? ` · started by ${h.assigned_by}` : ' · they set this up'}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(h)} disabled={busy}
                    className="text-xs text-text-muted hover:text-wcs-red disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>

                {preset ? (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {preset.levels.map(lvl => (
                      <button
                        key={lvl} disabled={busy}
                        onClick={() => setLevel(h, lvl)}
                        className={[
                          'px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-40',
                          Number(h.target) === lvl
                            ? 'bg-wcs-red text-white border-wcs-red'
                            : 'bg-surface text-text-primary border-border hover:border-text-muted',
                        ].join(' ')}
                      >
                        {nf.format(lvl)} {preset.unit}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {available.length ? (
        <div className="flex flex-wrap gap-2">
          {available.map(p => (
            <button
              key={p.kind} disabled={busy}
              onClick={() => add(p.kind, { target: p.target })}
              className="px-4 py-2 rounded-lg border border-border bg-surface text-sm font-semibold hover:border-text-muted disabled:opacity-40"
            >
              Add {p.label.toLowerCase()}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="flex gap-2 items-end border-t border-border pt-4"
        onSubmit={e => {
          e.preventDefault()
          const label = customName.trim()
          if (!label) return
          run(async () => {
            await api('/member-app/habits', {
              method: 'POST', body: JSON.stringify({ ...base, kind: 'custom', label }),
            })
            setCustomName('')
          })
        }}
      >
        <label className="text-sm flex-1">
          <span className="block text-text-muted mb-1">Their own habit</span>
          <input
            className={`${field} w-full`} value={customName} maxLength={40}
            placeholder="Stretch after training"
            onChange={e => setCustomName(e.target.value)}
          />
        </label>
        <button
          type="submit" disabled={busy || !customName.trim()}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-40"
        >
          Add
        </button>
      </form>
    </div>
  )
}
