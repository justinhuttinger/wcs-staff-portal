import { useCallback, useEffect, useMemo, useState } from 'react'
import { coachingApi } from './coachingApi'
import ProgramBuilder from './ProgramBuilder.jsx'
import ProgramPreview from './ProgramPreview.jsx'
import { pacificToday } from './volume'

// The template library: WCS templates everyone shares plus my own. Browse,
// preview, build, duplicate, publish, delete — and, when `assignTo` is set,
// pick one and copy it onto that client.
export default function TemplateLibrary({ assignTo, onAssigned, onCancel, isManager = true }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [templates, setTemplates] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [owner, setOwner] = useState('all')
  const [tag, setTag] = useState('')
  const [goal, setGoal] = useState('')
  const [level, setLevel] = useState('')
  const [days, setDays] = useState('')
  const [view, setView] = useState({ name: 'list' })
  const [assigning, setAssigning] = useState(null) // program being assigned

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 200)
    return () => clearTimeout(id)
  }, [q])

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await coachingApi.listTemplates({ q: debounced })
      setTemplates(r.programs || [])
    } catch (err) {
      setError(err.message)
    }
  }, [debounced])
  useEffect(() => { load() }, [load])

  const all = templates || []
  const options = useMemo(() => ({
    tags: [...new Set(all.flatMap(t => t.tags || []))].sort((a, b) => a.localeCompare(b)),
    goals: [...new Set(all.map(t => t.goal).filter(Boolean))].sort(),
    levels: [...new Set(all.map(t => t.level).filter(Boolean))].sort(),
  }), [all])
  const shown = all.filter(t =>
    (owner === 'all' || (owner === 'wcs' ? t.owner_staff_id == null : t.owner_staff_id != null)) &&
    (!tag || (t.tags || []).includes(tag)) &&
    (!goal || t.goal === goal) &&
    (!level || t.level === level) &&
    (!days || String(t.days_per_week || t.day_count) === days))

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 3000) }

  async function duplicate(t) {
    setError(null)
    try {
      const r = await coachingApi.copyProgram(t.id, { kind: 'template' })
      flash(`Copied to your templates as "${r.program.name}".`)
      setView({ name: 'edit', id: r.program.id })
      load()
    } catch (err) { setError(err.message) }
  }
  async function publish(t) {
    if (!window.confirm(`Publish "${t.name}" to the WCS library? Every trainer will see it.`)) return
    try { await coachingApi.publishProgram(t.id); flash('Published to the WCS library.'); load() } catch (err) { setError(err.message) }
  }
  async function remove(t) {
    const using = t.clients_using ? ` ${t.clients_using} client program${t.clients_using === 1 ? '' : 's'} made from it will keep their copy.` : ''
    if (!window.confirm(`Delete the template "${t.name}"?${using}`)) return
    try { await coachingApi.deleteProgram(t.id); flash('Template deleted.'); setView({ name: 'list' }); load() } catch (err) { setError(err.message) }
  }

  const canEdit = (t) => (t.owner_staff_id == null ? isManager : true)

  if (view.name === 'edit' || view.name === 'new') {
    return (
      <ProgramBuilder
        programId={view.id}
        create={view.name === 'new' ? { kind: 'template', publish: view.publish } : undefined}
        onClose={() => { setView({ name: 'list' }); load() }}
      />
    )
  }

  const btn = 'px-3 py-2 rounded-lg border border-border bg-surface text-sm font-semibold hover:border-text-muted'
  const primary = 'px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red-hover'

  if (view.name === 'preview') {
    return (
      <>
        <ProgramPreview
          programId={view.id}
          onBack={() => setView({ name: 'list' })}
          backLabel="All templates"
          actions={(p) => (
            <>
              {assignTo ? <button className={primary} onClick={() => setAssigning(p)}>Assign to {assignTo.first_name || 'client'}</button> : null}
              {canEdit(p) ? <button className={btn} onClick={() => setView({ name: 'edit', id: p.id })}>Edit</button> : null}
              <button className={btn} onClick={() => duplicate(p)}>Duplicate</button>
              {!assignTo && isManager && p.owner_staff_id != null ? <button className={btn} onClick={() => publish(p)}>Publish to WCS</button> : null}
              {!assignTo && canEdit(p) ? <button className={`${btn} text-text-muted hover:text-wcs-red`} onClick={() => remove(p)}>Delete</button> : null}
            </>
          )}
        />
        {assigning ? <AssignDialog program={assigning} member={assignTo} onClose={() => setAssigning(null)} onDone={onAssigned} /> : null}
      </>
    )
  }

  const field = 'px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm'
  return (
    <div className="space-y-4">
      <div className="border border-border rounded-xl bg-surface p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {onCancel ? (
            <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
          ) : null}
          <div>
            <h3 className="text-lg font-bold text-text-primary">{assignTo ? `Pick a template for ${assignTo.first_name || 'this client'}` : 'Program templates'}</h3>
            <p className="text-xs text-text-muted">{assignTo ? 'They get their own copy, so you can tailor it after.' : 'WCS templates are shared with every trainer. Yours are private until a manager publishes them.'}</p>
          </div>
          {!assignTo ? (
            <div className="ml-auto flex gap-2">
              <button className={primary} onClick={() => setView({ name: 'new' })}>+ New template</button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, tag, goal…" className={`${field} flex-1 min-w-[180px]`} />
          <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
            {[['all', 'All'], ['wcs', 'WCS'], ['mine', 'Mine']].map(([k, label]) => (
              <button key={k} onClick={() => setOwner(k)} className={`px-3 py-2 font-semibold ${owner === k ? 'bg-navy text-white' : 'bg-surface hover:bg-bg'}`}>{label}</button>
            ))}
          </div>
          <select value={goal} onChange={e => setGoal(e.target.value)} className={field} aria-label="Goal">
            <option value="">Any goal</option>{options.goals.map(g => <option key={g}>{g}</option>)}
          </select>
          <select value={level} onChange={e => setLevel(e.target.value)} className={field} aria-label="Level">
            <option value="">Any level</option>{options.levels.map(g => <option key={g}>{g}</option>)}
          </select>
          <select value={days} onChange={e => setDays(e.target.value)} className={field} aria-label="Days per week">
            <option value="">Any days</option>{[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n} days/week</option>)}
          </select>
          <select value={tag} onChange={e => setTag(e.target.value)} className={field} aria-label="Tag">
            <option value="">Any tag</option>{options.tags.map(g => <option key={g}>{g}</option>)}
          </select>
        </div>
        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
        {notice ? <p className="text-sm text-green-700">{notice}</p> : null}
      </div>

      <div className="border border-border rounded-xl bg-surface overflow-hidden">
        {templates === null ? (
          <p className="p-5 text-sm text-text-muted">Loading templates…</p>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-muted">
            {all.length ? 'No templates match those filters.' : 'No templates yet.'}
          </div>
        ) : (
          <>
            <div className="hidden md:grid grid-cols-[minmax(0,2.2fr)_90px_minmax(0,1.6fr)_90px_110px] gap-3 px-5 py-2 border-b border-border text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              <span>Program</span><span>Days</span><span>Tags</span><span>Clients</span><span>Last edit</span>
            </div>
            <ul className="divide-y divide-border">
              {shown.map(t => (
                <li key={t.id}>
                  <button
                    onClick={() => setView({ name: 'preview', id: t.id })}
                    className="w-full text-left grid md:grid-cols-[minmax(0,2.2fr)_90px_minmax(0,1.6fr)_90px_110px] gap-1 md:gap-3 px-5 py-3 hover:bg-bg md:items-center"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-text-primary truncate">{t.name}</span>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${t.owner_staff_id == null ? 'bg-navy text-white' : 'bg-wcs-red/10 text-wcs-red'}`}>
                          {t.owner_staff_id == null ? 'WCS' : 'Mine'}
                        </span>
                      </span>
                      <span className="block text-xs text-text-muted truncate">{[t.goal, t.level, t.equipment].filter(Boolean).join(' · ') || t.overview || ''}</span>
                    </span>
                    <span className="text-sm text-text-primary">
                      {t.day_count} day{t.day_count === 1 ? '' : 's'}
                      {t.days_per_week && t.days_per_week !== t.day_count ? <span className="text-xs text-text-muted"> · {t.days_per_week}/wk</span> : null}
                    </span>
                    <span className="flex flex-wrap gap-1 min-w-0">
                      {(t.tags || []).slice(0, 4).map(x => <span key={x} className="px-1.5 py-0.5 rounded-full bg-bg border border-border text-[11px]">{x}</span>)}
                      {(t.tags || []).length > 4 ? <span className="text-[11px] text-text-muted">+{t.tags.length - 4}</span> : null}
                    </span>
                    <span className="text-sm text-text-primary">{t.clients_using ? `${t.clients_using} using` : <span className="text-text-muted">—</span>}</span>
                    <span className="text-xs text-text-muted">{String(t.updated_at || '').slice(0, 10)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

// Copy a template onto a client. Today means it is their program now (and by
// default ends whatever they are on, yesterday); a future date waits behind
// their current program until then.
export function AssignDialog({ program, member, onClose, onDone }) {
  const [when, setWhen] = useState('now')
  const [date, setDate] = useState('')
  const [name, setName] = useState(program.name)
  const [replace, setReplace] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function assign(e) {
    e.preventDefault()
    if (when === 'later' && !date) { setError('Pick the start date.'); return }
    setBusy(true); setError(null)
    try {
      const r = await coachingApi.copyProgram(program.id, {
        kind: 'client',
        member_id: member.member_id,
        club_number: member.club_number,
        coach_staff_id: member.coach_staff_id || null,
        starts_on: when === 'later' ? date : null,
        name,
        replace_current: when === 'now' && replace,
      })
      onDone(r.program, r)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const field = 'w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm'
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <form onSubmit={assign} onClick={e => e.stopPropagation()} className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-md p-5 space-y-4">
        <div>
          <h3 className="text-base font-bold text-text-primary">Assign “{program.name}”</h3>
          <p className="text-xs text-text-muted">{member.first_name} {member.last_name} gets their own copy. Changing the template later will not change theirs.</p>
        </div>
        <label className="block text-sm">
          <span className="block text-text-muted mb-1">Program name for them</span>
          <input className={field} value={name} onChange={e => setName(e.target.value)} maxLength={120} />
        </label>
        <fieldset className="space-y-2 text-sm">
          <legend className="text-text-muted mb-1">Starts</legend>
          <label className="flex items-center gap-2"><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Now (it becomes their current program)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /> On a date (next block)</label>
          {when === 'later' ? <input type="date" min={pacificToday()} className={field} value={date} onChange={e => setDate(e.target.value)} /> : null}
        </fieldset>
        {when === 'now' ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={replace} onChange={e => setReplace(e.target.checked)} />
            <span>
              Replace their current program
              <span className="block text-xs text-text-muted">It ends yesterday, so this is the only one live. Their workout history is kept.</span>
            </span>
          </label>
        ) : null}
        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-text-muted">Cancel</button>
          <button disabled={busy} className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-50">
            {busy ? 'Assigning…' : 'Assign and edit'}
          </button>
        </div>
      </form>
    </div>
  )
}
