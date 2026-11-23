import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { projects } from '../../lib/api'
import { Button, ErrorBanner, EmptyState, Spinner, Select, TextInput } from '../adsmanager/ui'
import TaskEditor from './TaskEditor'
import { DEFAULT_FILTERS, PRIORITIES, PRIORITY, STATUSES, STATUS, OPEN, filterTasks, sortTasks, groupByStatus, isoDay } from './model'
import { dueLabel, shortDate } from '../hub/dates'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const SMALL = '!w-auto !py-1.5 !text-xs'
const FILTER_KEY = 'projects-filters'

function loadFilters() {
  try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'), q: '' } }
  catch { return DEFAULT_FILTERS }
}

function Initials({ name }) {
  const text = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <span title={name} className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg border border-border text-[10px] font-bold text-text-primary -ml-1.5 first:ml-0">
      {text}
    </span>
  )
}

function TaskRow({ t, nameOf, categoryName, onOpen, onStatus }) {
  const open = OPEN.includes(t.status)
  const due = open ? dueLabel(t.due_date) : null
  const pr = PRIORITY[t.priority]
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg/60 cursor-pointer" onClick={() => onOpen(t)}>
      <input type="checkbox" checked={t.status === 'complete'} disabled={t.status === 'skipped'}
        title={t.status === 'complete' ? 'Reopen' : 'Mark complete'}
        onClick={e => e.stopPropagation()}
        onChange={() => onStatus(t, t.status === 'complete' ? 'in_progress' : 'complete')}
        className="w-4 h-4 accent-wcs-red shrink-0" />
      <span className={`w-2 h-2 rounded-full shrink-0 ${pr?.dot}`} title={`${pr?.label} priority`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold truncate ${open ? 'text-text-primary' : 'text-text-muted line-through'}`}>{t.title}</p>
        <p className="text-[11px] text-text-muted truncate">
          {[categoryName(t.category_id), t.status === 'skipped' && t.skip_reason ? `Skipped: ${t.skip_reason}` : null].filter(Boolean).join(' · ') || ' '}
        </p>
      </div>
      {t.comment_count > 0 && (
        <span className="hidden sm:inline-flex items-center gap-1 shrink-0 text-[11px] text-text-muted" title={`${t.comment_count} comment${t.comment_count === 1 ? '' : 's'}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
          </svg>
          {t.comment_count}
        </span>
      )}
      {due && <span className={`hidden sm:inline shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${due.tone}`}>{due.text}</span>}
      <div className="hidden sm:flex shrink-0 w-24 justify-end">
        {t.assignees.slice(0, 4).map(a => <Initials key={a.staff_id} name={nameOf(a.staff_id)} />)}
        {t.assignees.length > 4 && <span className="text-[10px] text-text-muted ml-1 self-center">+{t.assignees.length - 4}</span>}
      </div>
      <select value={t.status} onClick={e => e.stopPropagation()} onChange={e => onStatus(t, e.target.value)}
        disabled={t.status === 'skipped'} title="Status"
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold bg-transparent ${STATUS[t.status]?.tone}`}>
        {STATUSES.filter(s => s.value !== 'skipped' || t.status === 'skipped').map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <span className="hidden md:inline shrink-0 w-14 text-right text-[11px] text-text-muted" title="Assigned date">{shortDate(t.created_at)}</span>
    </div>
  )
}

export default function ProjectsView({ onBack, openTaskId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(loadFilters)
  const [sort, setSort] = useState('due')
  const [editing, setEditing] = useState(undefined) // undefined closed, null new, task edit

  const load = useCallback(async () => {
    try { setData(await projects.tasks.list()) } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  // Open the task a Chat link pointed at, once, after the list loads.
  const openedLink = useRef(null)
  useEffect(() => {
    if (!data || !openTaskId || openedLink.current === openTaskId) return
    openedLink.current = openTaskId
    const hit = data.tasks.find(t => t.id === openTaskId)
    if (hit) setEditing(hit)
    else setError('That task could not be found.')
  }, [data, openTaskId])

  const setFilter = (k, v) => setFilters(f => {
    const next = { ...f, [k]: v }
    try { const { q: _q, ...keep } = next; localStorage.setItem(FILTER_KEY, JSON.stringify(keep)) } catch { /* ignore */ }
    return next
  })

  const names = useMemo(() => new Map((data?.members || []).map(m => [m.id, m.name])), [data])
  const nameOf = useCallback(id => names.get(id) || 'Former member', [names])
  const catNames = useMemo(() => new Map((data?.categories || []).map(c => [c.id, c.name])), [data])
  const categoryName = useCallback(id => (id ? catNames.get(id) || '' : ''), [catNames])

  // Saved rows come back without comment_count; keep the count the list had.
  const upsert = row => setData(d => {
    const prev = d.tasks.find(t => t.id === row.id)
    return { ...d, tasks: [{ comment_count: prev?.comment_count || 0, ...row }, ...d.tasks.filter(t => t.id !== row.id)] }
  })
  const bumpComments = id => setData(d => ({ ...d, tasks: d.tasks.map(t => (t.id === id ? { ...t, comment_count: (t.comment_count || 0) + 1 } : t)) }))

  const setStatus = async (t, status) => {
    if (status === t.status) return
    try { upsert((await projects.tasks.update(t.id, { status })).task) } catch (e) { setError(e.message) }
  }

  const visible = useMemo(() => sortTasks(filterTasks(data?.tasks || [], filters, { me: data?.me, today: isoDay() }), sort),
    [data, filters, sort])
  const groups = useMemo(() => groupByStatus(visible), [visible])
  const filtered = JSON.stringify({ ...filters, q: '' }) !== JSON.stringify({ ...DEFAULT_FILTERS, q: '' }) || !!filters.q

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div className={`${CARD} px-5 py-4 flex items-center justify-between gap-3 flex-wrap`}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-text-muted hover:text-text-primary text-sm">← Back</button>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Projects</h2>
            <p className="text-xs text-text-muted">Team tasks</p>
          </div>
        </div>
        <Button onClick={() => setEditing(null)} disabled={!data}>New task</Button>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {!data && !error && <div className={CARD}><Spinner /></div>}

      {data && (
        <div className={`${CARD} p-4 flex items-center gap-2 flex-wrap`}>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {[['me', 'My tasks'], ['all', 'Everyone']].map(([v, label]) => (
              <button key={v} onClick={() => setFilter('who', v)}
                className={`px-3 py-1.5 text-xs font-semibold ${filters.who === v ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted hover:text-text-primary'}`}>{label}</button>
            ))}
          </div>
          <Select value={filters.who === 'me' || filters.who === 'all' ? '' : filters.who} className={SMALL}
            onChange={e => setFilter('who', e.target.value || 'all')}
            options={[{ value: '', label: 'Any person' }, ...data.members.map(m => ({ value: m.id, label: m.name }))]} />
          <Select value={filters.status} onChange={e => setFilter('status', e.target.value)} className={SMALL}
            options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All but skipped' }, ...STATUSES.map(s => ({ value: s.value, label: s.label }))]} />
          <Select value={filters.priority} onChange={e => setFilter('priority', e.target.value)} className={SMALL}
            options={[{ value: '', label: 'Any priority' }, ...PRIORITIES.map(p => ({ value: p.value, label: p.label }))]} />
          <Select value={filters.category} onChange={e => setFilter('category', e.target.value)} className={SMALL}
            options={[{ value: '', label: 'All categories' }, ...data.categories.map(c => ({ value: c.id, label: c.name })), { value: 'none', label: 'No category' }]} />
          <Select value={filters.due} onChange={e => setFilter('due', e.target.value)} className={SMALL}
            options={[{ value: '', label: 'Any due date' }, { value: 'overdue', label: 'Overdue' }, { value: 'week', label: 'Due in 7 days' }, { value: 'none', label: 'No due date' }]} />
          <Select value={sort} onChange={e => setSort(e.target.value)} className={SMALL}
            options={[{ value: 'due', label: 'Sort: due date' }, { value: 'priority', label: 'Sort: priority' }, { value: 'newest', label: 'Sort: newest' }, { value: 'oldest', label: 'Sort: oldest' }]} />
          <TextInput value={filters.q} onChange={e => setFilter('q', e.target.value)} placeholder="Search" className="!w-40 !py-1.5 !text-xs ml-auto" />
          {filtered && (
            <button onClick={() => { setFilters(DEFAULT_FILTERS); try { localStorage.removeItem(FILTER_KEY) } catch { /* ignore */ } }}
              className="text-[11px] text-text-muted hover:text-text-primary">Reset</button>
          )}
        </div>
      )}

      {data && data.tasks.length === 0 && (
        <div className={CARD}>
          <EmptyState title="No tasks yet" hint="Create a task, assign it to one or more people, and set a due date."
            action={<Button onClick={() => setEditing(null)}>New task</Button>} />
        </div>
      )}
      {data && data.tasks.length > 0 && groups.length === 0 && (
        <div className={`${CARD} p-4 text-sm text-text-muted`}>
          {filters.who === 'me' ? 'Nothing assigned to you matches these filters.' : 'Nothing matches these filters.'}
        </div>
      )}

      {groups.length > 0 && (
        <div className={`${CARD} overflow-hidden divide-y divide-border`}>
          {groups.map(g => (
            <div key={g.value}>
              <div className="px-4 py-1 bg-bg/60 border-b border-border flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{g.label}</span>
                <span className="text-[10px] text-text-muted">{g.items.length}</span>
              </div>
              <div className="divide-y divide-border">
                {g.items.map(t => (
                  <TaskRow key={t.id} t={t} nameOf={nameOf} categoryName={categoryName}
                    onOpen={row => setEditing(row)} onStatus={setStatus} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== undefined && data && (
        <TaskEditor task={editing} members={data.members} categories={data.categories}
          defaultAssignee={data.me} nameOf={nameOf} categoryName={categoryName} me={data.me}
          onCommented={() => editing && bumpComments(editing.id)} onClose={() => setEditing(undefined)}
          onSaved={row => { upsert(row); setEditing(undefined) }} />
      )}
    </div>
  )
}
