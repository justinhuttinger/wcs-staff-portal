import { useState, useEffect, useMemo, useCallback } from 'react'
import { hub } from '../../lib/api'
import { CLUBS } from '../../config/locations'
import { Button, ErrorBanner, EmptyState, Spinner, Select } from '../adsmanager/ui'
import TaskEditor from './TaskEditor'
import TaskDetail from './TaskDetail'
import { dueLabel, shortDate } from './dates'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }
const PRIORITY_DOT = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-slate-400' }
const STATUS_LABEL = { todo: 'To do', waiting: 'Waiting', done: 'Done', dropped: 'Dropped' }
const CLUB_NAME = slug => CLUBS.find(c => c.slug === slug)?.name || slug

const SORTS = {
  due: (a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31'),
  assigned: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
  priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
}

function Chip({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${on
        ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
      {children}
    </button>
  )
}

function statusText(t) {
  if (t.status === 'waiting' && t.signal?.waitingDays != null) return `Waiting · ${t.signal.waitingDays}d`
  return STATUS_LABEL[t.status]
}

function TaskRow({ t, onOpen, onToggleDone }) {
  const due = t.status === 'done' || t.status === 'dropped' ? null : dueLabel(t.due_date)
  const closed = t.status === 'done' || t.status === 'dropped'
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg/60 cursor-pointer" onClick={() => onOpen(t)}>
      <input type="checkbox" checked={t.status === 'done'} title={t.status === 'done' ? 'Reopen' : 'Mark done'}
        onClick={e => e.stopPropagation()} onChange={() => onToggleDone(t)}
        className="w-4 h-4 accent-wcs-red shrink-0" />
      <span className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[t.priority]}`} title={`${t.priority} priority`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold truncate ${closed ? 'text-text-muted line-through' : 'text-text-primary'}`}>
          {t.title}
          {t.signal?.needsReview && <span className="inline-block w-2 h-2 rounded-full bg-wcs-red ml-2 align-middle" title="Needs review" />}
        </p>
        <p className="text-[11px] text-text-muted truncate">
          {[t.people?.map(p => p.name.split(' ')[0]).join(', '), t.clubs.map(CLUB_NAME).join(', ')].filter(Boolean).join(' · ') || ' '}
        </p>
      </div>
      {due && <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${due.tone}`}>{due.text}</span>}
      <span className="shrink-0 w-24 text-right text-[11px] text-text-muted">{t.signal?.allIn ? 'All in' : statusText(t)}</span>
      <span className="shrink-0 w-16 text-right text-[11px] text-text-muted" title="Assigned date">{shortDate(t.created_at)}</span>
    </div>
  )
}

export default function TasksSection({ gmailReady = false, refreshKey = 0, onGmailLost, openRequest, onDetailClosed }) {
  const [tasks, setTasks] = useState(null)
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(undefined) // undefined closed, null new, task edit
  const [openId, setOpenId] = useState(null)
  useEffect(() => { if (openRequest?.id) setOpenId(openRequest.id) }, [openRequest])
  const [clubFilter, setClubFilter] = useState([])
  const [catFilter, setCatFilter] = useState('')
  const [prioFilter, setPrioFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [sort, setSort] = useState('due')

  const load = useCallback(async () => {
    try {
      const r = await hub.tasks.list()
      setTasks(r.tasks); setCategories(r.categories)
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load, refreshKey])

  const upsert = row => setTasks(list => {
    const rest = (list || []).filter(t => t.id !== row.id)
    return [row, ...rest]
  })

  const toggleDone = async t => {
    try { upsert((await hub.tasks.update(t.id, { status: t.status === 'done' ? 'todo' : 'done' })).task) }
    catch (e) { setError(e.message) }
  }

  const groups = useMemo(() => {
    const visible = (tasks || []).filter(t => {
      const closed = t.status === 'done' || t.status === 'dropped'
      if (statusFilter) { if (t.status !== statusFilter) return false } else if (closed && !showClosed) return false
      if (clubFilter.length && !t.clubs.some(c => clubFilter.includes(c))) return false
      if (catFilter && (t.category_id || 'none') !== catFilter) return false
      if (prioFilter && t.priority !== prioFilter) return false
      return true
    }).sort(SORTS[sort])
    const out = categories.map(c => ({ id: c.id, name: c.name, items: visible.filter(t => t.category_id === c.id) }))
    out.push({ id: 'none', name: 'No category', items: visible.filter(t => !t.category_id || !categories.some(c => c.id === t.category_id)) })
    return out.filter(g => g.items.length)
  }, [tasks, categories, clubFilter, catFilter, prioFilter, statusFilter, showClosed, sort])

  const toggleClub = slug => setClubFilter(f => f.includes(slug) ? f.filter(s => s !== slug) : [...f, slug])

  if (!tasks && !error) return <div className={CARD}><Spinner /></div>

  return (
    <div className="space-y-4">
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      <div className={`${CARD} p-4 space-y-3`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => setEditing(null)}>New task</Button>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <Select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="!w-auto !py-1.5 !text-xs"
              options={[{ value: '', label: 'All categories' }, ...categories.map(c => ({ value: c.id, label: c.name })), { value: 'none', label: 'No category' }]} />
            <Select value={prioFilter} onChange={e => setPrioFilter(e.target.value)} className="!w-auto !py-1.5 !text-xs"
              options={[{ value: '', label: 'Any priority' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} />
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="!w-auto !py-1.5 !text-xs"
              options={[{ value: '', label: 'Open tasks' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
            <Select value={sort} onChange={e => setSort(e.target.value)} className="!w-auto !py-1.5 !text-xs"
              options={[{ value: 'due', label: 'Sort: due date' }, { value: 'assigned', label: 'Sort: oldest added' }, { value: 'priority', label: 'Sort: priority' }]} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold text-text-muted mr-1">Clubs</span>
          {CLUBS.map(c => <Chip key={c.slug} on={clubFilter.includes(c.slug)} onClick={() => toggleClub(c.slug)}>{c.name}</Chip>)}
          {clubFilter.length > 0 && <button onClick={() => setClubFilter([])} className="text-[11px] text-text-muted hover:text-text-primary ml-1">Clear</button>}
          {!statusFilter && (
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
              <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} className="accent-wcs-red" />
              Show done & dropped
            </label>
          )}
        </div>
      </div>

      {tasks && tasks.length === 0 && (
        <div className={CARD}>
          <EmptyState title="No tasks yet" hint="Add what's on your plate. Categories, clubs and due dates keep it sorted."
            action={<Button onClick={() => setEditing(null)}>New task</Button>} />
        </div>
      )}
      {tasks && tasks.length > 0 && groups.length === 0 && (
        <div className={`${CARD} p-4 text-sm text-text-muted`}>Nothing matches these filters.</div>
      )}

      {groups.length > 0 && (
        <div className={`${CARD} overflow-hidden divide-y divide-border`}>
          {groups.map(g => (
            <div key={g.id}>
              <div className="px-4 py-1 bg-bg/60 border-b border-border flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{g.name}</span>
                <span className="text-[10px] text-text-muted">{g.items.length}</span>
              </div>
              <div className="divide-y divide-border">
                {g.items.map(t => <TaskRow key={t.id} t={t} onOpen={row => setOpenId(row.id)} onToggleDone={toggleDone} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {openId && tasks?.find(t => t.id === openId) && (
        <TaskDetail task={tasks.find(t => t.id === openId)} gmailReady={gmailReady} onGmailLost={onGmailLost} onClose={() => { setOpenId(null); onDetailClosed?.() }}
          onEdit={t => setEditing(t)} onRefresh={load} />
      )}
      {editing !== undefined && (
        <TaskEditor task={editing} categories={categories} onClose={() => setEditing(undefined)}
          onSaved={row => { upsert(row); setEditing(undefined) }} />
      )}
    </div>
  )
}
