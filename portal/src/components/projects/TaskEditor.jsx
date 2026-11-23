import { useState } from 'react'
import { projects } from '../../lib/api'
import { Modal, Field, TextInput, TextArea, Select, Button, ErrorBanner } from '../adsmanager/ui'
import { PRIORITIES, STATUSES, STATUS } from './model'
import { shortDate } from '../hub/dates'
import TaskThread from './TaskThread'

const ACTIVE_STATUSES = STATUSES.filter(s => s.value !== 'skipped').map(s => ({ value: s.value, label: s.label }))

// Toggle chips for the members list. Anyone already on the task who has left
// the members list still shows, so they can be taken off.
function AssigneePicker({ members, value, onChange, nameOf }) {
  const ids = [...members.map(m => m.id), ...value.filter(id => !members.some(m => m.id === id))]
  const toggle = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])
  if (!ids.length) return <p className="text-xs text-text-muted">No members yet. An admin adds them in Admin &gt; Projects.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map(id => {
        const on = value.includes(id)
        return (
          <button key={id} type="button" onClick={() => toggle(id)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${on
              ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
            {nameOf(id)}
          </button>
        )
      })}
    </div>
  )
}

// Create or edit a task. `task` null = new (assigned to `defaultAssignee`).
export default function TaskEditor({ task, members, categories, defaultAssignee, nameOf, categoryName, me, onCommented, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    category_id: task?.category_id || '',
    priority: task?.priority || 'medium',
    start_date: task?.start_date || '',
    due_date: task?.due_date || '',
    status: task?.status || 'not_started',
    assignee_ids: task ? task.assignees.map(a => a.staff_id) : (defaultAssignee ? [defaultAssignee] : []),
  })
  const [skipping, setSkipping] = useState(false)
  const [skipReason, setSkipReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = k => e => setForm({ ...form, [k]: e.target.value })
  const skipped = task?.status === 'skipped'

  const send = async body => {
    setSaving(true); setError('')
    try {
      const r = task ? await projects.tasks.update(task.id, body) : await projects.tasks.create(body)
      onSaved(r.task)
    } catch (e) { setError(e.message); setSaving(false) }
  }

  const save = () => {
    const { status, ...rest } = form
    const body = {
      ...rest,
      category_id: form.category_id || null,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
    }
    // Status goes only when it changed, so completed_at/by stay put.
    if (!task || status !== task.status) body.status = status
    send(body)
  }

  const assignedBy = task?.created_by ? nameOf(task.created_by) : null
  const subtitle = task
    ? [`Assigned ${shortDate(task.created_at)}${assignedBy ? ` by ${assignedBy}` : ''}`,
      task.status === 'complete' && task.completed_at ? `Completed ${shortDate(task.completed_at)}${task.completed_by ? ` by ${nameOf(task.completed_by)}` : ''}` : null,
    ].filter(Boolean).join(' · ')
    : 'Assigned date is set to today when you save'

  return (
    <Modal title={task ? 'Edit task' : 'New task'} subtitle={subtitle} onClose={onClose}
      footer={(
        <>
          {task && !skipped && !skipping && (
            <Button variant="ghost" className="mr-auto" onClick={() => setSkipping(true)} disabled={saving}>Skip task</Button>
          )}
          {skipped && (
            <Button variant="secondary" className="mr-auto" disabled={saving}
              onClick={() => send({ status: 'not_started' })}>Restore</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {!skipped && <Button onClick={save} disabled={saving || !form.title.trim()}>{saving ? 'Saving…' : 'Save'}</Button>}
        </>
      )}>
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {skipped && (
        <div className="rounded-lg border border-border bg-bg px-4 py-3 text-sm text-text-muted">
          This task was skipped{task.skip_reason ? `: ${task.skip_reason}` : '.'} Restore it to make changes.
        </div>
      )}

      {skipping && (
        <div className="rounded-lg border border-border bg-bg p-4 space-y-3">
          <p className="text-sm text-text-primary font-semibold">Skip this task?</p>
          <p className="text-xs text-text-muted">It is hidden from the open lists but kept, and can be restored any time.</p>
          <TextInput placeholder="Reason (optional)" value={skipReason} onChange={e => setSkipReason(e.target.value)} autoFocus />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setSkipping(false)}>Keep it</Button>
            <Button variant="secondary" disabled={saving} onClick={() => send({ status: 'skipped', skip_reason: skipReason })}>Skip task</Button>
          </div>
        </div>
      )}

      <fieldset disabled={skipped} className="space-y-5 disabled:opacity-60">
        <Field label="Title" required>
          <TextInput value={form.title} onChange={set('title')} autoFocus={!task}
            onKeyDown={e => { if (e.key === 'Enter' && form.title.trim() && !saving) save() }} />
        </Field>
        <Field label="Description">
          <TextArea rows={5} value={form.description} onChange={set('description')} />
        </Field>
        <Field label="Assigned to">
          <AssigneePicker members={members} value={form.assignee_ids} nameOf={nameOf}
            onChange={assignee_ids => setForm({ ...form, assignee_ids })} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Priority">
            <Select value={form.priority} onChange={set('priority')} options={PRIORITIES.map(p => ({ value: p.value, label: p.label }))} />
          </Field>
          <Field label="Category">
            <Select value={form.category_id} onChange={set('category_id')}
              options={[{ value: '', label: 'No category' }, ...categories.map(c => ({ value: c.id, label: c.name }))]} />
          </Field>
          <Field label="Start date" hint="Optional. Used by the timeline view.">
            <TextInput type="date" value={form.start_date} onChange={set('start_date')} />
          </Field>
          <Field label="Due date">
            <TextInput type="date" value={form.due_date} onChange={set('due_date')} />
          </Field>
        </div>
        {!skipped && (
          <Field label="Status">
            <Select value={form.status} onChange={set('status')} options={ACTIVE_STATUSES} className="sm:max-w-[220px]" />
          </Field>
        )}
        {skipped && <p className="text-xs text-text-muted">Status: {STATUS.skipped.label}</p>}
      </fieldset>

      {task && (
        <TaskThread taskId={task.id} me={me} members={members} nameOf={nameOf} categoryName={categoryName}
          onCommented={onCommented} />
      )}
    </Modal>
  )
}
