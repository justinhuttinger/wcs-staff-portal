import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { projects } from '../../lib/api'
import { Button, ErrorBanner, EmptyState, Spinner } from '../adsmanager/ui'
import TaskSheet from './TaskSheet'
import TasksBoard from './TasksBoard'
import ProjectsCalendar from './ProjectsCalendar'
import ProjectsGantt from './ProjectsGantt'
import { SingleSelect, MultiSelect, Avatar, AvatarStack } from './Dropdown'
import {
  DEFAULT_FILTERS, PRIORITIES, PRIORITY, STATUSES, STATUS, OPEN, SORT_OPTIONS,
  normalizeFilters, activeFilterCount, filterTasks, sortTasks, isoDay,
} from './model'
import { dueLabel, shortDate } from '../hub/dates'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const FILTER_KEY = 'projects-filters-v2'
const VIEW_KEY = 'projects-view'
const SORT_KEY = 'projects-sort'
const SKIPPED_KEY = 'projects-board-skipped'
const readLocal = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback } catch { return fallback } }
const writeLocal = (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

const VIEWS = [
  // list-bullet, view-columns, calendar-days, chart-bar (timeline)
  { value: 'list', label: 'List', icon: 'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z' },
  { value: 'board', label: 'Board', icon: 'M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z' },
  { value: 'calendar', label: 'Calendar', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5' },
  { value: 'gantt', label: 'Timeline', icon: 'M3.75 6h10.5M7.5 12h12.75M5.25 18h9' },
]
const DUE_OPTIONS = [
  { value: '', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'week', label: 'Due in the next 7 days' },
  { value: 'none', label: 'No due date' },
]

function loadFilters() {
  try { return normalizeFilters(JSON.parse(localStorage.getItem(FILTER_KEY) || '{}')) } catch { return DEFAULT_FILTERS }
}

function Icon({ d, className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${className} shrink-0`} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

function NavItem({ active, onClick, icon, children, count }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition-colors ${active
        ? 'bg-wcs-red/10 text-wcs-red font-bold' : 'text-text-primary font-medium hover:bg-bg'}`}>
      {icon}
      <span className="truncate">{children}</span>
      {count != null && <span className={`ml-auto text-[11px] ${active ? 'text-wcs-red' : 'text-text-muted'}`}>{count}</span>}
    </button>
  )
}

function SideHeading({ children }) {
  return <p className="px-2.5 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-text-muted">{children}</p>
}

const COMMENT_ICON = 'M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z'
const CLIP_ICON = 'm18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13'

function TaskRow({ t, nameOf, categoryName, onOpen, onStatus }) {
  const open = OPEN.includes(t.status)
  const due = open ? dueLabel(t.due_date) : null
  const pr = PRIORITY[t.priority]
  const meta = [categoryName(t.category_id), t.status === 'skipped' && t.skip_reason ? `Skipped: ${t.skip_reason}` : null].filter(Boolean).join(' · ')
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg/60 cursor-pointer" onClick={() => onOpen(t)}>
      <input type="checkbox" checked={t.status === 'complete'} disabled={t.status === 'skipped'}
        title={t.status === 'complete' ? 'Reopen' : 'Mark complete'} aria-label={t.status === 'complete' ? 'Reopen' : 'Mark complete'}
        onClick={e => e.stopPropagation()}
        onChange={() => onStatus(t, t.status === 'complete' ? 'in_progress' : 'complete')}
        className="w-4 h-4 accent-wcs-red shrink-0" />
      <span className={`w-2 h-2 rounded-full shrink-0 ${pr?.dot}`} title={`${pr?.label} priority`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold truncate ${open ? 'text-text-primary' : 'text-text-muted line-through'}`}>{t.title}</p>
        {meta && <p className="text-[11px] text-text-muted truncate">{meta}</p>}
      </div>
      {t.comment_count > 0 && (
        <span className="hidden sm:inline-flex items-center gap-1 shrink-0 text-[11px] text-text-muted" title={`${t.comment_count} comments`}>
          <Icon d={COMMENT_ICON} className="w-3.5 h-3.5" />{t.comment_count}
        </span>
      )}
      {t.file_count > 0 && (
        <span className="hidden sm:inline-flex items-center gap-1 shrink-0 text-[11px] text-text-muted" title={`${t.file_count} files or links`}>
          <Icon d={CLIP_ICON} className="w-3.5 h-3.5" />{t.file_count}
        </span>
      )}
      {due && <span className={`hidden sm:inline shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${due.tone}`}>{due.text}</span>}
      <span className="hidden sm:flex shrink-0 w-20 justify-end">
        <AvatarStack ids={t.assignees.map(a => a.staff_id)} nameOf={nameOf} max={3} />
      </span>
      <select value={t.status} onClick={e => e.stopPropagation()} onChange={e => onStatus(t, e.target.value)}
        disabled={t.status === 'skipped'} title="Status" aria-label="Status"
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
  const [q, setQ] = useState('')
  const [view, setView] = useState(() => (VIEWS.some(v => v.value === readLocal(VIEW_KEY, 'list')) ? readLocal(VIEW_KEY, 'list') : 'list'))
  const [sort, setSort] = useState(() => (SORT_OPTIONS.some(s => s.value === readLocal(SORT_KEY, '')) ? readLocal(SORT_KEY, '') : 'urgent'))
  const [showSkipped, setShowSkipped] = useState(() => readLocal(SKIPPED_KEY, '0') === '1')
  const [editing, setEditing] = useState(undefined) // undefined closed, null new, task open

  const switchView = v => {
    setView(v); writeLocal(VIEW_KEY, v)
    if (v !== 'board' && sort === 'manual') chooseSort('urgent')
  }
  const chooseSort = v => { setSort(v); writeLocal(SORT_KEY, v) }
  const toggleSkipped = on => { setShowSkipped(on); writeLocal(SKIPPED_KEY, on ? '1' : '0') }
  const updateFilters = patch => setFilters(f => {
    const next = { ...f, ...patch }
    writeLocal(FILTER_KEY, JSON.stringify(next))
    return next
  })
  const clearFilters = () => updateFilters({ ...DEFAULT_FILTERS, scope: filters.scope })

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

  const names = useMemo(() => new Map((data?.members || []).map(m => [m.id, m.name])), [data])
  const nameOf = useCallback(id => names.get(id) || 'Former member', [names])
  const catNames = useMemo(() => new Map((data?.categories || []).map(c => [c.id, c.name])), [data])
  const categoryName = useCallback(id => (id ? catNames.get(id) || '' : ''), [catNames])

  // Saved rows come back without counts; keep the counts the list had.
  const upsert = row => setData(d => {
    const prev = d.tasks.find(t => t.id === row.id)
    return { ...d, tasks: [{ comment_count: prev?.comment_count || 0, file_count: prev?.file_count || 0, ...row }, ...d.tasks.filter(t => t.id !== row.id)] }
  })
  const patchLocal = (id, patch) => setData(d => ({ ...d, tasks: d.tasks.map(t => (t.id === id ? { ...t, ...patch } : t)) }))
  const bumpComments = id => setData(d => ({ ...d, tasks: d.tasks.map(t => (t.id === id ? { ...t, comment_count: (t.comment_count || 0) + 1 } : t)) }))

  // Optimistic change, then save; reload on failure.
  const change = async (t, patch) => {
    patchLocal(t.id, patch)
    try { upsert((await projects.tasks.update(t.id, patch)).task) } catch (e) { setError(e.message); load() }
  }
  const setStatus = (t, status) => { if (status !== t.status) change(t, { status }) }
  const moveTask = (t, status, sort_order) => change(t, status === t.status ? { sort_order } : { status, sort_order })

  const board = view === 'board'
  const opts = { me: data?.me, today: isoDay(), board, showSkipped }
  const f = { ...filters, q }
  const visible = useMemo(() => sortTasks(filterTasks(data?.tasks || [], f, opts), sort),
    [data, filters, q, sort, board, showSkipped]) // eslint-disable-line react-hooks/exhaustive-deps
  const countFor = scope => filterTasks(data?.tasks || [], { ...f, scope, people: scope === 'me' ? null : f.people }, opts).length
  const active = activeFilterCount(filters, { board })

  const memberOptions = (data?.members || []).map(m => ({ value: m.id, label: m.name, icon: <Avatar id={m.id} name={m.name} size={20} /> }))
  const categoryOptions = [...(data?.categories || []).map(c => ({ value: c.id, label: c.name })), { value: 'none', label: 'No category' }]
  const priorityOptions = PRIORITIES.map(p => ({ value: p.value, label: p.label, icon: <span className={`w-2 h-2 rounded-full ${p.dot}`} /> }))
  const sortOptions = SORT_OPTIONS.filter(s => !s.boardOnly || board)
  const showSort = view === 'list' || view === 'board'

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <div className={`${CARD} px-5 py-3.5 flex items-center gap-3`}>
        <button onClick={onBack} className="text-text-muted hover:text-text-primary text-sm">← Back</button>
        <div>
          <h2 className="text-lg font-bold text-text-primary leading-tight">Projects</h2>
          <p className="text-xs text-text-muted">Team tasks</p>
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError('')} />
      {!data && !error && <div className={CARD}><Spinner /></div>}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-[236px_minmax(0,1fr)] gap-4 items-start">
          {/* Sidebar */}
          <aside className={`${CARD} p-3 space-y-5 lg:sticky lg:top-4`}>
            <Button onClick={() => setEditing(null)} className="w-full">New task</Button>

            <div>
              <SideHeading>View</SideHeading>
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-0.5">
                {VIEWS.map(v => (
                  <NavItem key={v.value} active={view === v.value} onClick={() => switchView(v.value)} icon={<Icon d={v.icon} />}>{v.label}</NavItem>
                ))}
              </div>
            </div>

            <div>
              <SideHeading>Assigned to</SideHeading>
              <NavItem active={filters.scope === 'me'} onClick={() => updateFilters({ scope: 'me' })}
                icon={<Avatar id={data.me} name={nameOf(data.me)} size={18} />} count={countFor('me')}>My tasks</NavItem>
              <NavItem active={filters.scope === 'everyone'} onClick={() => updateFilters({ scope: 'everyone' })}
                icon={<Icon d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />}
                count={countFor('everyone')}>Everyone</NavItem>
              {filters.scope === 'everyone' && (
                <div className="mt-2 px-0.5">
                  <MultiSelect variant="field" value={filters.people} onChange={people => updateFilters({ people })}
                    options={memberOptions} noun="people" allLabel="All members" />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <SideHeading>Filters</SideHeading>
              {board ? (
                <label className="flex items-center gap-2 px-2.5 text-sm text-text-primary cursor-pointer">
                  <input type="checkbox" checked={showSkipped} onChange={e => toggleSkipped(e.target.checked)} className="accent-wcs-red" />
                  Show skipped column
                </label>
              ) : (
                <MultiSelect variant="field" label="Status" value={filters.statuses} onChange={statuses => updateFilters({ statuses })}
                  options={STATUSES.map(s => ({ value: s.value, label: s.label }))} noun="statuses" allLabel="All" nullForAll={false} />
              )}
              <MultiSelect variant="field" label="Priority" value={filters.priorities} onChange={priorities => updateFilters({ priorities })}
                options={priorityOptions} noun="priorities" allLabel="Any" />
              <MultiSelect variant="field" label="Category" value={filters.categories} onChange={categories => updateFilters({ categories })}
                options={categoryOptions} noun="categories" allLabel="All" />
              <SingleSelect variant="field" label="Due" value={filters.due} onChange={due => updateFilters({ due })} options={DUE_OPTIONS} />
              {active > 0 && (
                <button type="button" onClick={clearFilters} className="px-2.5 text-xs text-text-muted underline hover:text-text-primary">
                  Clear {active} filter{active === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </aside>

          {/* Main */}
          <div className="min-w-0 space-y-4">
            <div className={`${CARD} px-3 py-2.5 flex items-center gap-2 flex-wrap`}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks"
                className="flex-1 min-w-[160px] max-w-sm rounded-full border border-border bg-bg px-3.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30" />
              <span className="text-xs text-text-muted ml-auto">{visible.length} task{visible.length === 1 ? '' : 's'}</span>
              {showSort && <SingleSelect label="Sort" value={sort} onChange={chooseSort} options={sortOptions} width={230} />}
            </div>

            {data.tasks.length === 0 && (
              <div className={CARD}>
                <EmptyState title="No tasks yet" hint="Create a task, assign it to one or more people, and set a due date."
                  action={<Button onClick={() => setEditing(null)}>New task</Button>} />
              </div>
            )}
            {data.tasks.length > 0 && visible.length === 0 && view !== 'calendar' && view !== 'gantt' && (
              <div className={`${CARD} p-6 text-sm text-text-muted text-center`}>
                {filters.scope === 'me' ? 'Nothing assigned to you matches these filters.' : 'Nothing matches these filters.'}
                {active > 0 && <> <button type="button" onClick={clearFilters} className="underline hover:text-text-primary">Clear filters</button></>}
              </div>
            )}

            {view === 'list' && visible.length > 0 && (
              <div className={`${CARD} overflow-hidden`}>
                <div className="px-4 py-1.5 bg-bg/60 border-b border-border flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  <span>{SORT_OPTIONS.find(s => s.value === sort)?.label}</span>
                  <span className="hidden md:inline">Assigned</span>
                </div>
                <div className="divide-y divide-border">
                  {visible.map(t => (
                    <TaskRow key={t.id} t={t} nameOf={nameOf} categoryName={categoryName} onOpen={setEditing} onStatus={setStatus} />
                  ))}
                </div>
              </div>
            )}
            {board && data.tasks.length > 0 && (
              <TasksBoard tasks={visible} showSkipped={showSkipped} sort={sort} nameOf={nameOf} categoryName={categoryName}
                onOpen={setEditing} onMove={moveTask} />
            )}
            {view === 'calendar' && data.tasks.length > 0 && (
              <ProjectsCalendar tasks={visible} onOpen={setEditing} onReschedule={(t, due_date) => change(t, { due_date })} />
            )}
            {view === 'gantt' && data.tasks.length > 0 && (
              <ProjectsGantt tasks={visible} categories={data.categories} nameOf={nameOf} onOpen={setEditing} onDates={change} />
            )}
          </div>
        </div>
      )}

      {editing !== undefined && data && (
        <TaskSheet task={editing} members={data.members} categories={data.categories}
          defaultAssignee={data.me} nameOf={nameOf} categoryName={categoryName} me={data.me}
          onCommented={() => editing && bumpComments(editing.id)}
          onFilesChanged={n => editing && patchLocal(editing.id, { file_count: n })}
          onClose={() => setEditing(undefined)}
          onSaved={row => { upsert(row); setEditing(row) }} />
      )}
    </div>
  )
}
