import { useCallback, useEffect, useState } from 'react'
import { coachingApi } from './coachingApi'
import { Card, StatCard, Initials, prettyDay, daysSince, btn, primaryBtn, field } from './ui.jsx'

// Kahunas's client list: stat tiles, then one row per client with their club,
// program, last workout and how many workouts this week.
export default function ClientsList({ me, onOpen, onAdd }) {
  const [status, setStatus] = useState('active')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [moving, setMoving] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 200)
    return () => clearTimeout(id)
  }, [q])

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await coachingApi.listClients({ status, q: debounced }))
    } catch (err) {
      setError(err.message)
    }
  }, [status, debounced])
  useEffect(() => { load() }, [load])

  const counts = data?.counts
  const clients = data?.clients || []
  const today = data?.today
  const showCoach = me.isManager

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard label="Active" value={counts?.active} onClick={() => setStatus('active')} active={status === 'active'} />
        <StatCard label="New last 7 days" value={counts?.newLast7} />
        <StatCard label="Trained this week" value={counts?.trainedThisWeek} tone="good" />
        <StatCard label="Not trained 7+ days" value={counts?.notTrained7} tone={counts?.notTrained7 ? 'bad' : 'default'} />
        <StatCard label="Archived" value={counts?.archived} onClick={() => setStatus('archived')} active={status === 'archived'} />
      </div>

      <Card bodyClass="p-3 sm:p-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, program, coach…" className={`${field} flex-1 min-w-[200px]`} />
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
          {[['active', 'Active'], ['archived', 'Archived']].map(([k, label]) => (
            <button key={k} onClick={() => setStatus(k)} className={`px-3 py-2 font-semibold ${status === k ? 'bg-navy text-white' : 'bg-surface hover:bg-bg'}`}>{label}</button>
          ))}
        </div>
        {me.isManager ? <button className={btn} onClick={() => setMoving(true)}>Move clients</button> : null}
        <button className={primaryBtn} onClick={onAdd}>+ Add client</button>
        {error ? <p className="basis-full text-sm text-wcs-red">{error}</p> : null}
        {notice ? <p className="basis-full text-sm text-green-700">{notice}</p> : null}
      </Card>

      <Card>
        {data === null ? (
          <p className="p-5 text-sm text-text-muted">Loading clients…</p>
        ) : clients.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-muted space-y-3">
            <p>
              {debounced ? 'Nobody matches that search.'
                : status === 'archived' ? 'No archived clients.'
                : 'No active clients yet. Add a member to start coaching them.'}
            </p>
            {!debounced && status === 'active' ? <button className={primaryBtn} onClick={onAdd}>+ Add client</button> : null}
          </div>
        ) : (
          <>
            <div className={`hidden md:grid ${showCoach ? 'grid-cols-[minmax(0,2fr)_110px_minmax(0,1.4fr)_minmax(0,1fr)_120px_90px]' : 'grid-cols-[minmax(0,2fr)_110px_minmax(0,1.6fr)_120px_90px]'} gap-3 px-4 py-2 border-b border-border text-[11px] font-semibold uppercase tracking-wide text-text-muted`}>
              <span>Client</span><span>Club</span><span>Program</span>{showCoach ? <span>Coach</span> : null}<span>Last workout</span><span>This week</span>
            </div>
            <ul className="divide-y divide-border">
              {clients.map(c => {
                const gap = daysSince(c.last_workout_on, today)
                const stale = c.status === 'active' && (gap == null || gap >= 7)
                return (
                  <li key={`${c.member_id}|${c.club_number}`}>
                    <button
                      onClick={() => onOpen(c)}
                      className={`w-full text-left px-4 py-3 hover:bg-bg grid gap-1 md:gap-3 md:items-center ${showCoach ? 'md:grid-cols-[minmax(0,2fr)_110px_minmax(0,1.4fr)_minmax(0,1fr)_120px_90px]' : 'md:grid-cols-[minmax(0,2fr)_110px_minmax(0,1.6fr)_120px_90px]'}`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <Initials name={c.name} size="sm" />
                        <span className="min-w-0">
                          <span className="block font-semibold text-text-primary truncate">{c.name}</span>
                          <span className="block text-xs text-text-muted truncate">{c.email || ''}</span>
                        </span>
                      </span>
                      <span className="text-sm text-text-primary">{c.club_name}</span>
                      <span className="text-sm min-w-0 truncate">
                        {c.current_program ? <span className="text-text-primary">{c.current_program.name}</span> : <span className="text-amber-600">No program</span>}
                        {c.next_program ? <span className="block text-xs text-text-muted truncate">Next: {c.next_program.name}, {prettyDay(c.next_program.starts_on)}</span> : null}
                      </span>
                      {showCoach ? <span className="text-sm text-text-muted truncate">{c.coach?.name || 'No coach'}</span> : null}
                      <span className={`text-sm ${stale ? 'text-wcs-red' : 'text-text-primary'}`}>
                        {c.last_workout_on ? (gap === 0 ? 'Today' : gap === 1 ? 'Yesterday' : `${gap} days ago`) : 'Never'}
                      </span>
                      <span className="text-sm text-text-primary">
                        <span className="md:hidden text-text-muted">This week: </span>{c.workouts_this_week}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>

      {moving ? (
        <MoveClientsDialog
          onClose={() => setMoving(false)}
          onDone={(moved) => { setMoving(false); setNotice(`Moved ${moved} client${moved === 1 ? '' : 's'}.`); load() }}
        />
      ) : null}
    </div>
  )
}

// Managers: move every client of one coach to another (someone leaving, or
// rebalancing a club).
function MoveClientsDialog({ onClose, onDone }) {
  const [coaches, setCoaches] = useState(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    coachingApi.coaches().then(r => setCoaches(r.coaches || [])).catch(err => setError(err.message))
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!from || !to) { setError('Pick both coaches.'); return }
    if (from === to) { setError('Pick two different coaches.'); return }
    setBusy(true); setError(null)
    try {
      const r = await coachingApi.reassignAll({ from_staff_id: from, to_staff_id: to })
      onDone(r.moved || 0)
    } catch (err) {
      setError(err.message); setBusy(false)
    }
  }

  const sel = `${field} w-full`
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-md p-5 space-y-4">
        <div>
          <h3 className="text-base font-bold text-text-primary">Move clients to another coach</h3>
          <p className="text-xs text-text-muted">Every client of the first coach at your clubs moves to the second. Their programs and history stay as they are.</p>
        </div>
        <label className="block text-sm"><span className="block text-text-muted mb-1">From</span>
          <select className={sel} value={from} onChange={e => setFrom(e.target.value)}>
            <option value="">Pick a coach</option>
            {(coaches || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="block text-sm"><span className="block text-text-muted mb-1">To</span>
          <select className={sel} value={to} onChange={e => setTo(e.target.value)}>
            <option value="">Pick a coach</option>
            {(coaches || []).filter(c => c.id !== from).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-text-muted">Cancel</button>
          <button disabled={busy} className={primaryBtn}>{busy ? 'Moving…' : 'Move clients'}</button>
        </div>
      </form>
    </div>
  )
}
