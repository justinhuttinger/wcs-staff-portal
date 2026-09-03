import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import MobileHeader from './MobileHeader'

const nf = new Intl.NumberFormat('en-US')
const field = 'w-full px-3 py-3 rounded-lg border border-border bg-bg text-base'

// The same habits a member sees on their home screen, from the floor: set one
// up mid-conversation, or check whether last month's habit actually stuck.
export default function MobileHabits({ member, onBack }) {
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

  if (!state) {
    return (
      <div className="pt-4 px-4">
        <MobileHeader title="Habits" onBack={onBack} />
        {error ? <p className="text-sm text-wcs-red">{error}</p> : <p className="text-sm text-text-muted">Loading…</p>}
      </div>
    )
  }

  const tracking = new Set(state.habits.map(h => h.kind))
  const available = state.presets.filter(p => !tracking.has(p.kind))

  return (
    <div className="pt-4 px-4 pb-8">
      <MobileHeader title="Habits" onBack={onBack} />

      {error ? <p className="text-sm text-wcs-red mb-2">{error}</p> : null}

      {state.habits.length === 0 ? (
        <p className="text-sm text-text-muted mb-4">
          Nothing yet. Add one and it lands on their home screen.
        </p>
      ) : (
        <ul className="space-y-3 mb-5">
          {state.habits.map(h => {
            const preset = state.presets.find(p => p.kind === h.kind)
            return (
              <li key={h.id} className="border border-border rounded-xl bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">
                      {h.label}
                      {h.target ? (
                        <span className="font-normal text-text-muted">
                          {' '}{nf.format(h.target)} {h.unit}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-text-muted">
                      Hit {h.days_hit} of the last {h.window_days} days
                      {h.done_today ? ' · done today' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => run(() => api(`/member-app/habits/${h.id}`, { method: 'DELETE' }))}
                    disabled={busy}
                    className="text-xs text-text-muted whitespace-nowrap disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>

                {preset ? (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {preset.levels.map(lvl => (
                      <button
                        key={lvl} disabled={busy}
                        onClick={() => run(() => api(`/member-app/habits/${h.id}`, {
                          method: 'PUT', body: JSON.stringify({ target: lvl }),
                        }))}
                        className={[
                          'px-3 py-2 rounded-lg text-sm border disabled:opacity-40',
                          Number(h.target) === lvl
                            ? 'bg-wcs-red text-white border-wcs-red'
                            : 'bg-surface text-text-primary border-border',
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

      {available.map(p => (
        <button
          key={p.kind} disabled={busy}
          onClick={() => run(() => api('/member-app/habits', {
            method: 'POST', body: JSON.stringify({ ...base, kind: p.kind, target: p.target }),
          }))}
          className="w-full py-3 mb-2 rounded-lg border border-border bg-surface font-semibold disabled:opacity-40"
        >
          Add {p.label.toLowerCase()}
        </button>
      ))}

      <form
        className="mt-4"
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
        <label className="block text-sm mb-2">
          <span className="block text-text-muted mb-1">Their own habit</span>
          <input
            className={field} value={customName} maxLength={40}
            placeholder="Stretch after training"
            onChange={e => setCustomName(e.target.value)}
          />
        </label>
        <button
          type="submit" disabled={busy || !customName.trim()}
          className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold disabled:opacity-50"
        >
          Add habit
        </button>
      </form>
    </div>
  )
}
