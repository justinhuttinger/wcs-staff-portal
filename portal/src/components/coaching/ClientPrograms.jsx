import { useCallback, useEffect, useState } from 'react'
import { coachingApi } from './coachingApi'
import ProgramBuilder from './ProgramBuilder.jsx'
import ProgramPreview from './ProgramPreview.jsx'
import TemplateLibrary from './TemplateLibrary.jsx'
import { pacificToday, programStatus } from './volume'

// One client's programs: what they are on now, what is queued next, and what
// they have finished. Start from a template (the usual way) or from scratch,
// then edit the client's own copy in the builder.
// `initialView`: 'templates' or 'new' opens straight onto assigning or building
// (the Coaching profile's header buttons). `onChange` runs after any change.
export default function ClientPrograms({ member, initialView = null, onChange }) {
  const [programs, setPrograms] = useState(null)
  const [sessions, setSessions] = useState(null)
  const [view, setView] = useState(initialView ? { name: initialView } : { name: 'list' })
  const [scheduling, setScheduling] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const name = `${member.first_name || ''} ${member.last_name || ''}`.trim()

  const load = useCallback(async () => {
    setError(null)
    try {
      const [p, s] = await Promise.all([
        coachingApi.listClientPrograms(member),
        coachingApi.listSessions(member, 10).catch(() => ({ sessions: [] })),
      ])
      setPrograms(p.programs || [])
      setSessions(s.sessions || [])
      onChange?.()
    } catch (err) {
      setError(err.message)
    }
    // Keyed on the ids, not the object: onChange reloads the parent, which
    // hands down a fresh object and would otherwise loop.
  }, [member.member_id, member.club_number]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 3500) }

  async function patch(p, body, msg) {
    setError(null)
    try { await coachingApi.patchProgram(p.id, body); flash(msg); load() } catch (err) { setError(err.message) }
  }
  async function saveAsTemplate(p) {
    const title = window.prompt('Name for the new template (saved to your templates):', p.name)
    if (title === null) return
    try {
      await coachingApi.copyProgram(p.id, { kind: 'template', name: title })
      flash(`Saved "${title || p.name}" to your templates.`)
    } catch (err) { setError(err.message) }
  }

  if (view.name === 'edit' || view.name === 'new') {
    return (
      <ProgramBuilder
        programId={view.id}
        clientName={name}
        create={view.name === 'new' ? { kind: 'client', member } : undefined}
        onClose={() => { setView({ name: 'list' }); load() }}
      />
    )
  }
  if (view.name === 'templates') {
    return (
      <TemplateLibrary
        assignTo={member}
        onCancel={() => setView({ name: 'list' })}
        onAssigned={(program, result) => {
          if (result?.warning) setError(result.warning)
          const ended = result?.replaced ? ` Ended ${result.replaced} current program${result.replaced === 1 ? '' : 's'}.` : ''
          flash(program.starts_on ? `Assigned. It takes over on ${program.starts_on}.` : `Assigned.${ended} Tailor it for them below.`)
          setView({ name: 'edit', id: program.id })
        }}
      />
    )
  }
  if (view.name === 'preview') {
    return (
      <ProgramPreview
        programId={view.id}
        onBack={() => setView({ name: 'list' })}
        backLabel={`${member.first_name || 'Client'}'s programs`}
        actions={(p) => (
          <>
            <button className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold" onClick={() => setView({ name: 'edit', id: p.id })}>Edit</button>
            <button className="px-3 py-2 rounded-lg border border-border text-sm font-semibold" onClick={() => saveAsTemplate(p)}>Save as template</button>
          </>
        )}
      />
    )
  }

  const today = pacificToday()
  const list = programs || []
  const current = list.filter(p => programStatus(p, today) === 'current')
    .sort((a, b) => String(b.starts_on || b.created_at).localeCompare(String(a.starts_on || a.created_at)))
  const scheduled = list.filter(p => programStatus(p, today) === 'scheduled')
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
  const past = list.filter(p => ['ended', 'archived'].includes(programStatus(p, today)))

  const row = (p, kind, live) => (
    <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <button onClick={() => setView({ name: 'preview', id: p.id })} className="flex-1 min-w-[200px] text-left">
        <span className="flex items-center gap-2">
          <span className="font-semibold text-text-primary">{p.name}</span>
          {live ? <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-green-100 text-green-800">Live</span> : null}
        </span>
        <span className="block text-xs text-text-muted">
          {p.day_count} day{p.day_count === 1 ? '' : 's'}
          {kind === 'scheduled' ? ` · starts ${p.starts_on}` : ''}
          {kind === 'current' && p.starts_on ? ` · started ${p.starts_on}` : ''}
          {p.ends_on ? ` · ${p.ends_on < today ? 'ended' : 'ends'} ${p.ends_on}` : ''}
          {!p.is_active ? ' · archived' : ''}
          {` · edited ${String(p.updated_at).slice(0, 10)}`}
        </span>
      </button>
      <div className="flex flex-wrap gap-1.5 text-sm">
        {p.is_active ? <button className="px-3 py-1.5 rounded-lg bg-wcs-red text-white font-semibold" onClick={() => setView({ name: 'edit', id: p.id })}>Edit</button> : null}
        {p.is_active ? <button className="px-3 py-1.5 rounded-lg border border-border font-medium hover:border-text-muted" onClick={() => setScheduling(p)}>Schedule</button> : null}
        {p.is_active
          ? <button className="px-3 py-1.5 rounded-lg border border-border font-medium text-text-muted hover:text-wcs-red" onClick={() => patch(p, { is_active: false }, `Archived "${p.name}". Its workout history is kept.`)}>Archive</button>
          : <button className="px-3 py-1.5 rounded-lg border border-border font-medium" onClick={() => patch(p, { is_active: true }, `Restored "${p.name}".`)}>Restore</button>}
      </div>
    </li>
  )

  const group = (title, items, kind, hint) => (
    <div className="border border-border rounded-xl bg-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-baseline gap-2">
        <h4 className="font-bold text-text-primary">{title}</h4>
        <span className="text-xs text-text-muted">{hint}</span>
      </div>
      {items.length ? <ul className="divide-y divide-border">{items.map((p, i) => row(p, kind, kind === 'current' && i === 0))}</ul>
        : <p className="px-4 py-4 text-sm text-text-muted">{kind === 'current' ? 'Nothing running right now.' : kind === 'scheduled' ? 'No next block queued.' : 'Nothing finished yet.'}</p>}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-xl bg-surface p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h3 className="font-bold text-text-primary">Training programs</h3>
          <p className="text-xs text-text-muted">The newest program that has started is the one {member.first_name || 'they'} sees.</p>
        </div>
        <button className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red-hover" onClick={() => setView({ name: 'templates' })}>Assign a template</button>
        <button className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:border-text-muted" onClick={() => setView({ name: 'new' })}>New program</button>
        {error ? <p className="basis-full text-sm text-wcs-red">{error}</p> : null}
        {notice ? <p className="basis-full text-sm text-green-700">{notice}</p> : null}
      </div>

      {programs === null ? (
        <div className="border border-border rounded-xl bg-surface p-5 text-sm text-text-muted">Loading programs…</div>
      ) : (
        <>
          {group('Current', current, 'current', current.length > 1 ? 'Only the top one is live' : '')}
          {group('Scheduled', scheduled, 'scheduled', 'Takes over on its start date')}
          {past.length ? group('Past', past, 'past', 'Ended or archived; history kept') : null}
        </>
      )}

      {sessions && sessions.length ? (
        <div className="border border-border rounded-xl bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border"><h4 className="font-bold text-text-primary">Recent workouts</h4></div>
          <ul className="divide-y divide-border">
            {sessions.map(s => (
              <li key={s.id} className="px-4 py-2.5 text-sm flex flex-wrap gap-x-3">
                <span className="font-semibold">{s.performed_on}</span>
                <span>{s.day_name || 'Workout'}</span>
                <span className="text-text-muted">{s.sets.length} set{s.sets.length === 1 ? '' : 's'}{s.completed_at ? '' : ' · not finished'}{s.logged_by ? ` · logged by ${s.logged_by}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {scheduling ? (
        <ScheduleDialog
          program={scheduling}
          onClose={() => setScheduling(null)}
          onSave={async (body) => { await coachingApi.patchProgram(scheduling.id, body); setScheduling(null); flash('Schedule saved.'); load() }}
        />
      ) : null}
    </div>
  )
}

function ScheduleDialog({ program, onClose, onSave }) {
  const [startsOn, setStartsOn] = useState(program.starts_on || '')
  const [endsOn, setEndsOn] = useState(program.ends_on || '')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const field = 'w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm'

  async function submit(e) {
    e.preventDefault()
    if (startsOn && endsOn && endsOn < startsOn) { setError('The end date is before the start date.'); return }
    setBusy(true); setError(null)
    try { await onSave({ starts_on: startsOn || null, ends_on: endsOn || null }) } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-md p-5 space-y-4">
        <div>
          <h3 className="text-base font-bold text-text-primary">Schedule “{program.name}”</h3>
          <p className="text-xs text-text-muted">A future start keeps their current program until then. Ending keeps the program and every logged workout.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm"><span className="block text-text-muted mb-1">Starts on</span>
            <input type="date" className={field} value={startsOn} onChange={e => setStartsOn(e.target.value)} /></label>
          <label className="block text-sm"><span className="block text-text-muted mb-1">Ends on</span>
            <input type="date" className={field} value={endsOn} onChange={e => setEndsOn(e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" className="px-2 py-1 rounded border border-border" onClick={() => setStartsOn('')}>Start now</button>
          <button type="button" className="px-2 py-1 rounded border border-border" onClick={() => setEndsOn(pacificToday())}>End today</button>
          <button type="button" className="px-2 py-1 rounded border border-border" onClick={() => setEndsOn('')}>No end date</button>
        </div>
        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-text-muted">Cancel</button>
          <button disabled={busy} className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
