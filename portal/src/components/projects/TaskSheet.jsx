import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { projects } from '../../lib/api'
import { ErrorBanner } from '../adsmanager/ui'
import { PRIORITIES, ACTIVE_STATUSES, STATUS } from './model'
import { shortDate, dueLabel } from '../hub/dates'
import { SingleSelect, MultiSelect, Avatar, AvatarStack } from './Dropdown'
import TaskThread from './TaskThread'
import TaskFiles from './TaskFiles'

const DATE_INPUT = 'w-full px-2 py-1.5 rounded-lg text-sm border border-transparent bg-transparent text-text-primary hover:bg-bg focus:bg-bg focus:border-border focus:outline-none'

function Prop({ label, children }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] sm:grid-cols-[130px_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 border-b border-border last:border-b-0">
      <span className="text-xs font-semibold text-text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function formFrom(task, defaultAssignee) {
  return {
    title: task?.title || '',
    description: task?.description || '',
    category_id: task?.category_id || '',
    priority: task?.priority || 'medium',
    start_date: task?.start_date || '',
    due_date: task?.due_date || '',
    status: task?.status || 'not_started',
    assignee_ids: task ? task.assignees.map(a => a.staff_id) : (defaultAssignee ? [defaultAssignee] : []),
  }
}

// Full-screen task view: everything about the task on the left, the comment
// chat on the right (stacked on narrow screens). `task` null = a new task;
// once created it stays open as that task so files and comments can follow.
export default function TaskSheet({ task, members, categories, defaultAssignee, nameOf, categoryName, me, onCommented, onFilesChanged, onClose, onSaved }) {
  const initial = useMemo(() => formFrom(task, defaultAssignee), [task, defaultAssignee])
  const [form, setForm] = useState(initial)
  useEffect(() => { setForm(initial) }, [initial])
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose() }

  // Escape closes the view, unless a dropdown is open (it takes the first one).
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || document.body.dataset.pmDropdown) return
      if (confirmClose) setConfirmClose(false)
      else requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const send = async body => {
    setSaving(true); setError('')
    try {
      const r = task ? await projects.tasks.update(task.id, body) : await projects.tasks.create(body)
      onSaved(r.task)
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const save = () => {
    if (!form.title.trim()) { setError('Add a title first'); return }
    const { status, ...rest } = form
    const body = { ...rest, category_id: form.category_id || null, start_date: form.start_date || null, due_date: form.due_date || null }
    if (!task || status !== task.status) body.status = status
    send(body)
  }

  // Assignee options: current members, plus anyone still on the task who has
  // left the members list (so they can be taken off).
  const peopleOptions = useMemo(() => {
    const ids = [...members.map(m => m.id), ...form.assignee_ids.filter(id => !members.some(m => m.id === id))]
    return ids.map(id => ({ value: id, label: nameOf(id), icon: <Avatar id={id} name={nameOf(id)} size={20} /> }))
  }, [members, form.assignee_ids, nameOf])

  const statusOptions = ACTIVE_STATUSES.map(s => ({ value: s.value, label: s.label }))
  const priorityOptions = PRIORITIES.map(p => ({ value: p.value, label: p.label, icon: <span className={`w-2 h-2 rounded-full ${p.dot}`} /> }))
  const categoryOptions = [{ value: '', label: 'No category' }, ...categories.map(c => ({ value: c.id, label: c.name }))]
  const due = task && ['not_started', 'in_progress'].includes(task.status) ? dueLabel(task.due_date) : null
  const assignedBy = task?.created_by ? nameOf(task.created_by) : null

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex p-2 sm:p-5"
      onMouseDown={e => { if (e.target === e.currentTarget) requestClose() }}>
      <div role="dialog" aria-modal="true" aria-label={task ? task.title : 'New task'}
        className="flex-1 min-h-0 bg-surface border border-border rounded-2xl shadow-2xl overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(340px,2fr)]">

        {/* Left: the task */}
        <div className="min-w-0 lg:overflow-y-auto px-5 sm:px-7 py-5 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            {task
              ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${STATUS[task.status]?.tone}`}>{STATUS[task.status]?.label}</span>
              : <span className="px-2 py-0.5 rounded-full text-[11px] font-bold border border-border text-text-muted">New task</span>}
            {due && <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${due.tone}`}>{due.text}</span>}
            <span className="text-[11px] text-text-muted">
              {task ? `Assigned ${shortDate(task.created_at)}${assignedBy ? ` by ${assignedBy}` : ''}` : 'The assigned date is set to today when you create it'}
              {task?.status === 'complete' && task.completed_at ? ` · Completed ${shortDate(task.completed_at)}${task.completed_by ? ` by ${nameOf(task.completed_by)}` : ''}` : ''}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {savedFlash && <span className="text-xs font-semibold text-green-600">Saved</span>}
              {dirty && !savedFlash && <span className="text-xs text-text-muted">Unsaved changes</span>}
              <button type="button" onClick={save} disabled={saving || (task && !dirty)}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-wcs-red text-white hover:bg-wcs-red/90 disabled:bg-wcs-red/40">
                {saving ? 'Saving…' : task ? 'Save' : 'Create task'}
              </button>
              <button type="button" onClick={requestClose} aria-label="Close"
                className="text-text-muted hover:text-text-primary text-2xl leading-none px-1.5">×</button>
            </div>
          </div>

          {confirmClose && (
            <div className="rounded-lg border border-border bg-bg px-4 py-3 flex items-center gap-3 flex-wrap">
              <p className="text-sm text-text-primary flex-1">You have unsaved changes.</p>
              <button type="button" onClick={() => setConfirmClose(false)} className="text-sm font-semibold text-text-muted hover:text-text-primary px-2">Keep editing</button>
              <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-bg border border-border text-text-primary">Discard</button>
              <button type="button" onClick={() => { setConfirmClose(false); save() }} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-wcs-red text-white">Save</button>
            </div>
          )}
          <ErrorBanner error={error} onDismiss={() => setError('')} />

          <div className="space-y-5 min-w-0">
            <textarea value={form.title} onChange={e => set('title', e.target.value)} rows={1} placeholder="Task title" autoFocus={!task}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (!saving && (dirty || !task)) save() } }}
              className="w-full resize-none bg-transparent text-2xl font-bold tracking-tight text-text-primary placeholder:text-text-muted/60 border-0 border-b border-transparent focus:border-border focus:outline-none py-1 [field-sizing:content]" />

            <div className="rounded-xl border border-border">
              <Prop label="Assigned to">
                <MultiSelect variant="ghost" value={form.assignee_ids} onChange={v => set('assignee_ids', v || [])}
                  options={peopleOptions} noun="people" applyLabel="Done" allowEmpty nullForAll={false} width={260}
                  renderValue={sel => (sel.length
                    ? <span className="inline-flex items-center gap-2"><AvatarStack ids={sel} nameOf={nameOf} max={5} size={20} /><span className="truncate">{sel.map(nameOf).join(', ')}</span></span>
                    : <span className="text-text-muted">Unassigned</span>)} />
              </Prop>
              <Prop label="Status">
                <SingleSelect variant="ghost" value={form.status} onChange={v => set('status', v)} options={statusOptions} />
              </Prop>
              <Prop label="Priority">
                <SingleSelect variant="ghost" value={form.priority} onChange={v => set('priority', v)} options={priorityOptions} />
              </Prop>
              <Prop label="Category">
                <SingleSelect variant="ghost" value={form.category_id} onChange={v => set('category_id', v)} options={categoryOptions} />
              </Prop>
              <Prop label="Start date">
                <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} className={DATE_INPUT} aria-label="Start date" />
              </Prop>
              <Prop label="Due date">
                <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={DATE_INPUT} aria-label="Due date" />
              </Prop>
            </div>

            <div>
              <h4 className="text-sm font-bold text-text-primary mb-2">Description</h4>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={6}
                placeholder="What needs to happen, links, details…"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm leading-relaxed text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30 resize-y" />
            </div>
          </div>

          {task
            ? <TaskFiles taskId={task.id} nameOf={nameOf} onCountChange={onFilesChanged} />
            : <p className="text-xs text-text-muted">Files, links and comments open up once the task is created.</p>}
        </div>

        {/* Right: the chat */}
        <div className="min-w-0 min-h-[480px] lg:min-h-0 border-t lg:border-t-0 lg:border-l border-border bg-bg flex flex-col">
          {task
            ? <TaskThread taskId={task.id} me={me} members={members} nameOf={nameOf} categoryName={categoryName} onCommented={onCommented} />
            : (
              <div className="flex-1 flex items-center justify-center p-8 text-center">
                <p className="text-sm text-text-muted max-w-xs">Comments show up here after you create the task. Assignees get a Google Chat message for each one.</p>
              </div>
            )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
