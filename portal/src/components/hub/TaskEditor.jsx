import { useState } from 'react'
import { hub } from '../../lib/api'
import { CLUBS } from '../../config/locations'
import { Modal, Field, TextInput, TextArea, Select, Button, ErrorBanner } from '../adsmanager/ui'
import { statusOptions, canSubmitOnEnter } from './taskForm'

const TIME_OPTIONS = [
  { value: '', label: 'Auto (Claude estimates)' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1.5 hours' },
  { value: '120', label: '2 hours' },
  { value: '180', label: '3 hours' },
]

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

export function ClubPicker({ value, onChange }) {
  const toggle = slug => onChange(value.includes(slug) ? value.filter(s => s !== slug) : [...value, slug])
  return (
    <div className="flex flex-wrap gap-1.5">
      {CLUBS.map(c => {
        const on = value.includes(c.slug)
        return (
          <button key={c.slug} type="button" onClick={() => toggle(c.slug)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${on
              ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
            {c.name}
          </button>
        )
      })}
    </div>
  )
}

// Create or edit a task. `task` null = new.
export default function TaskEditor({ task, categories, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    category_id: task?.category_id || '',
    priority: task?.priority || 'medium',
    due_date: task?.due_date || '',
    clubs: task?.clubs || [],
    status: task?.status || 'todo',
    minutes_override: task?.minutes_override ? String(task.minutes_override) : '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = k => e => setForm({ ...form, [k]: e.target.value })

  const save = async () => {
    setSaving(true); setError('')
    try {
      const { status, ...rest } = form
      const body = { ...rest, category_id: form.category_id || null, due_date: form.due_date || null, minutes_override: form.minutes_override ? Number(form.minutes_override) : null }
      // Status is only sent on edit, and only when it changed (keeps completed_at).
      if (task && status !== task.status) body.status = status
      const { task: row } = task ? await hub.tasks.update(task.id, body) : await hub.tasks.create(body)
      onSaved(row)
    } catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose}
      subtitle={task ? `Added ${new Date(task.created_at).toLocaleDateString()}` : undefined}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.title.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      )}>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      <Field label="Title" required>
        <TextInput value={form.title} onChange={set('title')} autoFocus
          onKeyDown={e => { if (canSubmitOnEnter({ key: e.key, title: form.title, saving })) save() }} />
      </Field>
      <Field label="Description">
        <TextArea rows={4} value={form.description} onChange={set('description')} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Category">
          <Select value={form.category_id} onChange={set('category_id')}
            options={[{ value: '', label: 'No category' }, ...categories.map(c => ({ value: c.id, label: c.name }))]} />
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={set('priority')} options={PRIORITY_OPTIONS} />
        </Field>
        <Field label="Due date">
          <TextInput type="date" value={form.due_date} onChange={set('due_date')} />
        </Field>
      </div>
      <Field label="Time needed" hint="For Plan my week. Auto lets Claude estimate.">
        <Select value={form.minutes_override} onChange={set('minutes_override')} options={TIME_OPTIONS} className="sm:max-w-[240px]" />
      </Field>
      {task && (
        <Field label="Status">
          <Select value={form.status} onChange={set('status')} options={statusOptions()} className="sm:max-w-[200px]" />
        </Field>
      )}
      <Field label="Clubs">
        <ClubPicker value={form.clubs} onChange={clubs => setForm({ ...form, clubs })} />
      </Field>
    </Modal>
  )
}
