import { useState } from 'react'
import { hub } from '../../lib/api'
import { CLUBS } from '../../config/locations'
import { Modal, Field, TextInput, TextArea, Select, Button, ErrorBanner } from '../adsmanager/ui'

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
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = k => e => setForm({ ...form, [k]: e.target.value })

  const save = async () => {
    setSaving(true); setError('')
    try {
      const body = { ...form, category_id: form.category_id || null, due_date: form.due_date || null }
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
          onKeyDown={e => { if (e.key === 'Enter' && form.title.trim()) save() }} />
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
      <Field label="Clubs">
        <ClubPicker value={form.clubs} onChange={clubs => setForm({ ...form, clubs })} />
      </Field>
    </Modal>
  )
}
