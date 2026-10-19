import { useCallback, useEffect, useMemo, useState } from 'react'
import { coachingApi } from './coachingApi'
import ClientPrograms from './ClientPrograms.jsx'
import ClientLogs from './ClientLogs.jsx'
import ClientProgress from './ClientProgress.jsx'
import MemberAppMessages from '../admin/memberapp/MemberAppMessages.jsx'
import MemberAppHabits from '../admin/memberapp/MemberAppHabits.jsx'
import MemberAppNutrition from '../admin/memberapp/MemberAppNutrition.jsx'
import { Card, StatusPill, Initials, CopyButton, BackLink, ago, prettyDay, btn, primaryBtn, field } from './ui.jsx'

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'workout', label: 'Workout' },
  { key: 'logs', label: 'Logs' },
  { key: 'progress', label: 'Progress' },
  { key: 'messages', label: 'Messages' },
  { key: 'habits', label: 'Habits' },
  { key: 'nutrition', label: 'Nutrition' },
]

const ACTIVITY_DOT = {
  program_assigned: 'bg-navy',
  program_updated: 'bg-text-muted',
  workout_completed: 'bg-green-600',
  message: 'bg-wcs-red',
}

// One client, Kahunas style: a header card with the numbers a coach checks
// first, then tabs for the program, the log, progress and the conversation.
export default function ClientProfile({ member, initialTab = 'dashboard', me, onBack }) {
  const [tab, setTab] = useState(initialTab)
  const [workoutView, setWorkoutView] = useState(null) // 'templates' | 'new'
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [reassigning, setReassigning] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await coachingApi.getClient(member))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [member])
  useEffect(() => { load() }, [load])

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 3500) }

  // One stable object per client for the tabs, so reloading the header does
  // not make every tab fetch again.
  const c0 = data?.client
  const client = useMemo(() => (c0 ? {
    member_id: c0.member_id, club_number: c0.club_number,
    first_name: c0.first_name, last_name: c0.last_name, name: c0.name,
    coach_staff_id: c0.coach?.id || null,
  } : null), [c0?.member_id, c0?.club_number, c0?.first_name, c0?.last_name, c0?.name, c0?.coach?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) {
    return (
      <Card bodyClass="p-5 space-y-3">
        <BackLink onClick={onBack}>All clients</BackLink>
        <p className={`text-sm ${error ? 'text-wcs-red' : 'text-text-muted'}`}>{error || 'Loading client…'}</p>
      </Card>
    )
  }

  const c = data.client
  const archived = c.status === 'archived'

  async function setStatus(status) {
    const msg = status === 'archived'
      ? `Archive ${c.first_name || c.name}? They lose the Training tab in the app. Their programs and workout history are kept.`
      : `Reactivate ${c.first_name || c.name}? Their Training tab comes back.`
    if (!window.confirm(msg)) return
    setBusy(true)
    try {
      await coachingApi.patchClient(client, { status })
      flash(status === 'archived' ? 'Archived. Their history is kept.' : 'Reactivated.')
      await load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  function startWorkout(view) { setWorkoutView(view); setTab('workout') }

  const stat = (label, value) => (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="text-sm font-semibold text-text-primary truncate">{value}</div>
    </div>
  )

  return (
    <div className="space-y-4">
      <Card bodyClass="p-4 sm:p-5 space-y-4">
        <BackLink onClick={onBack}>All clients</BackLink>
        <div className="flex flex-wrap items-start gap-4">
          <Initials name={c.name} size="lg" />
          <div className="flex-1 min-w-[220px] space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-text-primary">{c.name}</h2>
              <StatusPill status={c.status} />
            </div>
            <div className="text-sm text-text-muted">
              {c.club_name}{c.membership_type ? ` · ${c.membership_type}` : ''}{c.member_active === false ? ' · membership inactive' : ''}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
              {c.email ? <span className="flex items-center gap-1.5">{c.email} <CopyButton text={c.email} /></span> : null}
              {c.phone ? <span className="flex items-center gap-1.5">{c.phone} <CopyButton text={c.phone} /></span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!archived ? <button className={primaryBtn} onClick={() => startWorkout('templates')}>Assign template</button> : null}
            {!archived ? <button className={btn} onClick={() => startWorkout('new')}>New program</button> : null}
            <button className={btn} onClick={() => setTab('messages')}>Message</button>
            {me.isManager && c.status !== 'not_client' ? <button className={btn} onClick={() => setReassigning(true)}>Reassign</button> : null}
            {c.status === 'active' ? <button className={`${btn} text-text-muted hover:text-wcs-red`} disabled={busy} onClick={() => setStatus('archived')}>Archive</button> : null}
            {archived ? <button className={primaryBtn} disabled={busy} onClick={() => setStatus('active')}>Reactivate</button> : null}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 border-t border-border pt-4">
          {stat('Coach', c.coach?.name || 'No coach')}
          {stat('Member since', c.member_since ? prettyDay(c.member_since) : 'Unknown')}
          {stat('Last active in app', c.last_active_in_app ? ago(c.last_active_in_app) : 'Not yet')}
          {stat('Current program', c.current_program?.name || 'None')}
          {stat('This week', `${c.workouts_this_week} workout${c.workouts_this_week === 1 ? '' : 's'}`)}
          {stat('Total workouts', c.total_workouts)}
        </div>
        {c.status === 'not_client' ? (
          <p className="text-sm text-amber-600">Not a training client yet. Use Add client to give them the Training tab.</p>
        ) : null}
        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
        {notice ? <p className="text-sm text-green-700">{notice}</p> : null}
      </Card>

      <div className="bg-surface border border-border rounded-xl p-1 flex gap-1 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); if (t.key !== 'workout') setWorkoutView(null) }}
            className={`shrink-0 px-3.5 py-2 rounded-lg text-sm font-semibold ${tab === t.key ? 'bg-wcs-red text-white' : 'text-text-primary hover:bg-bg'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' ? (
        <ProfileDashboard data={data} client={client} onSaved={load} onLogs={() => setTab('logs')} />
      ) : tab === 'workout' ? (
        <ClientPrograms key={workoutView || 'list'} member={client} initialView={workoutView} onChange={load} />
      ) : tab === 'logs' ? (
        <ClientLogs member={client} />
      ) : tab === 'progress' ? (
        <ClientProgress member={client} />
      ) : tab === 'messages' ? (
        <MemberAppMessages member={client} />
      ) : tab === 'habits' ? (
        <Card bodyClass="p-4"><MemberAppHabits member={client} /></Card>
      ) : tab === 'nutrition' ? (
        <Card bodyClass="p-4"><MemberAppNutrition member={client} /></Card>
      ) : null}

      {reassigning ? (
        <ReassignDialog
          client={c}
          onClose={() => setReassigning(false)}
          onSave={async (coachId) => {
            await coachingApi.patchClient(client, { coach_staff_id: coachId })
            setReassigning(false)
            flash('Coach changed.')
            load()
          }}
        />
      ) : null}
    </div>
  )
}

function ProfileDashboard({ data, client, onSaved, onLogs }) {
  const [draft, setDraft] = useState(data.notes?.body || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState(null)
  const dirty = draft !== (data.notes?.body || '')

  async function save() {
    setSaving(true); setError(null)
    try {
      await coachingApi.saveNotes(client, draft)
      setSaved('Saved.')
      setTimeout(() => setSaved(null), 2500)
      onSaved()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  const workouts = data.activity.filter(a => a.kind === 'workout_completed').slice(0, 5)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card title="Activity" hint="Programs, workouts and messages">
        {data.activity.length ? (
          <ol className="px-4 py-3 space-y-3">
            {data.activity.map((a, i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${ACTIVITY_DOT[a.kind] || 'bg-text-muted'}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-text-primary break-words">{a.text}</span>
                  <span className="block text-xs text-text-muted">{ago(a.at)}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : <p className="px-4 py-5 text-sm text-text-muted">Nothing yet. Assign a program to get them started.</p>}
      </Card>
      <div className="space-y-4">
        <Card title="Client notes" hint="Only staff see these">
          <div className="p-3 space-y-2">
            <textarea
              value={draft} onChange={e => setDraft(e.target.value)} rows={6}
              placeholder="Injuries, goals, what they like, what to watch for…"
              className={`${field} w-full`}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted flex-1">
                {data.notes?.updated_at ? `Last saved ${ago(data.notes.updated_at)}${data.notes.updated_by ? ` by ${data.notes.updated_by}` : ''}` : 'No notes yet.'}
              </span>
              {saved ? <span className="text-xs text-green-700">{saved}</span> : null}
              <button className={primaryBtn} disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save notes'}</button>
            </div>
            {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
          </div>
        </Card>
        <Card title="Latest workouts" action={workouts.length ? <button className="text-xs font-semibold text-wcs-red hover:underline" onClick={onLogs}>See logs</button> : null}>
          {workouts.length ? (
            <ul className="divide-y divide-border">
              {workouts.map((w, i) => (
                <li key={i} className="px-4 py-2.5 text-sm flex gap-2">
                  <span className="flex-1 text-text-primary">{w.text.replace(/^Completed /, '')}</span>
                  <span className="text-xs text-text-muted shrink-0">{ago(w.at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-4 text-sm text-text-muted">No finished workouts yet.</p>}
        </Card>
      </div>
    </div>
  )
}

function ReassignDialog({ client, onClose, onSave }) {
  const [coaches, setCoaches] = useState(null)
  const [coach, setCoach] = useState(client.coach?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    coachingApi.coaches().then(r => setCoaches(r.coaches || [])).catch(err => setError(err.message))
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!coach || coach === client.coach?.id) { onClose(); return }
    setBusy(true); setError(null)
    try { await onSave(coach) } catch (err) { setError(err.message); setBusy(false) }
  }

  const options = (coaches || []).filter(c => !c.club_numbers?.length || c.club_numbers.includes(client.club_number) || c.id === client.coach?.id)
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-sm p-5 space-y-4">
        <div>
          <h3 className="text-base font-bold text-text-primary">Reassign {client.first_name || client.name}</h3>
          <p className="text-xs text-text-muted">The new coach sees them in Coaching right away. Programs and history stay.</p>
        </div>
        <select className={`${field} w-full`} value={coach} onChange={e => setCoach(e.target.value)}>
          <option value="">Pick a coach</option>
          {options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {coaches && !options.length ? <p className="text-xs text-text-muted">No other coaches at {client.club_name}.</p> : null}
        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-text-muted">Cancel</button>
          <button disabled={busy} className={primaryBtn}>{busy ? 'Saving…' : 'Reassign'}</button>
        </div>
      </form>
    </div>
  )
}
