import { useEffect, useState } from 'react'
import { coachingApi } from './coachingApi'
import { Card, StatCard, Initials, ago, prettyDay, btn, primaryBtn } from './ui.jsx'

// The coach's home: how my clients are doing this week, the workouts they
// just finished, who is waiting on a reply, and what starts soon.
export default function CoachDashboard({ me, onOpen, onAdd, onNewProgram, onClients }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    coachingApi.dashboard()
      .then(r => { if (live) setData(r) })
      .catch(err => { if (live) setError(err.message) })
    return () => { live = false }
  }, [])

  if (!data) {
    return (
      <Card bodyClass="p-5">
        <p className={`text-sm ${error ? 'text-wcs-red' : 'text-text-muted'}`}>{error || 'Loading your clients…'}</p>
      </Card>
    )
  }

  const c = data.counts
  const nobody = c.active === 0 && c.archived === 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Active clients" value={c.active} onClick={onClients} />
        <StatCard label="Trained this week" value={c.trainedThisWeek} tone="good" sub={c.active ? `of ${c.active}` : null} />
        <StatCard label="Not trained 7+ days" value={c.notTrained7} tone={c.notTrained7 ? 'bad' : 'default'} />
        <StatCard label="New last 7 days" value={c.newLast7} />
      </div>

      {nobody ? (
        <Card bodyClass="p-6 sm:p-8 text-center space-y-3">
          <h3 className="text-lg font-bold text-text-primary">No clients yet</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            {me.isManager
              ? 'Nobody at your clubs is set up for coaching yet. Add a member to get them started in the member app.'
              : 'Add a member you train. They get a Training tab in the member app, and you build their program here.'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button className={primaryBtn} onClick={onAdd}>+ Add a client</button>
            <button className={btn} onClick={onNewProgram}>Build a program template</button>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title="Latest workouts" hint="Finished in the member app">
          {data.latestWorkouts.length ? (
            <ul className="divide-y divide-border">
              {data.latestWorkouts.map(w => (
                <li key={w.session_id}>
                  <button onClick={() => onOpen(w.member, 'logs')} className="w-full text-left px-4 py-3 hover:bg-bg flex items-center gap-3">
                    <Initials name={w.member.name} size="sm" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-text-primary truncate">
                        {w.member.name} <span className="font-normal text-text-muted">finished {w.day_name || 'a workout'}</span>
                      </span>
                      <span className="block text-xs text-text-muted truncate">
                        {w.total_sets} set{w.total_sets === 1 ? '' : 's'} · {prettyDay(w.performed_on)}{w.note ? ` · “${w.note}”` : ''}
                      </span>
                    </span>
                    <span className="text-xs text-text-muted shrink-0">{ago(w.completed_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-5 text-sm text-text-muted">No finished workouts in the last 60 days.</p>}
        </Card>

        <div className="space-y-4">
          <Card title="Waiting on a reply">
            {data.unreadMessages.length ? (
              <ul className="divide-y divide-border">
                {data.unreadMessages.map(m => (
                  <li key={`${m.member.member_id}|${m.member.club_number}`}>
                    <button onClick={() => onOpen(m.member, 'messages')} className="w-full text-left px-4 py-3 hover:bg-bg flex items-center gap-3">
                      <Initials name={m.member.name} size="sm" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-text-primary truncate">{m.member.name}</span>
                        <span className="block text-xs text-text-muted truncate">{m.last_body}</span>
                      </span>
                      <span className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[11px] text-text-muted">{ago(m.at)}</span>
                        {m.count > 1 ? <span className="text-[11px] bg-wcs-red text-white rounded-full px-1.5">{m.count}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-4 text-sm text-text-muted">You are all caught up.</p>}
          </Card>

          {data.scheduledStarting.length ? (
            <Card title="Starting this week">
              <ul className="divide-y divide-border">
                {data.scheduledStarting.map(p => (
                  <li key={p.program_id}>
                    <button onClick={() => onOpen(p.member, 'workout')} className="w-full text-left px-4 py-2.5 hover:bg-bg text-sm">
                      <span className="font-semibold text-text-primary">{p.member.name}</span>
                      <span className="text-text-muted"> · {p.name} · {prettyDay(p.starts_on)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {data.newestClients.length ? (
            <Card title="Newest clients">
              <ul className="divide-y divide-border">
                {data.newestClients.map(n => (
                  <li key={`${n.member.member_id}|${n.member.club_number}`}>
                    <button onClick={() => onOpen(n.member)} className="w-full text-left px-4 py-2.5 hover:bg-bg flex items-center gap-2 text-sm">
                      <span className="font-semibold text-text-primary flex-1 truncate">{n.member.name}</span>
                      <span className="text-xs text-text-muted">{n.member.club_name} · {ago(n.upgraded_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="Quick actions" bodyClass="p-3 grid grid-cols-2 gap-2">
            <button className={primaryBtn} onClick={onAdd}>+ Add client</button>
            <button className={btn} onClick={onNewProgram}>New program</button>
          </Card>
        </div>
      </div>
    </div>
  )
}
