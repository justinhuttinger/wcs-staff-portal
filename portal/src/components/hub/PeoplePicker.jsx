import { useState, useEffect } from 'react'
import { hub } from '../../lib/api'
import { Field, TextInput, Select, Button, ErrorBanner } from '../adsmanager/ui'
import { ClubPicker } from './TaskEditor'

const NEW = '__new__'

// "Add person" for a task: pick a saved person, or "+ New person…" (saved for
// next time). Saved people bring their clubs with them.
export default function PeoplePicker({ task, onTask, onAdded }) {
  const [contacts, setContacts] = useState([])
  const [choice, setChoice] = useState('')
  const [form, setForm] = useState({ name: '', email: '', clubs: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { hub.contacts.list().then(r => setContacts(r.contacts)).catch(e => setError(e.message)) }, [])

  const taken = new Set((onTask || []).map(p => String(p.email).toLowerCase()))
  const options = [
    { value: '', label: 'Add person…' },
    ...contacts.filter(c => !taken.has(c.email.toLowerCase())).map(c => ({ value: c.id, label: c.name })),
    { value: NEW, label: '+ New person…' },
  ]

  const add = async body => {
    setBusy(true); setError('')
    try {
      const { person } = await hub.people.add(task.id, body)
      onAdded(person)
      setChoice(''); setForm({ name: '', email: '', clubs: [] })
      if (!body.contact_id) hub.contacts.list().then(r => setContacts(r.contacts)).catch(() => {})
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const pick = value => {
    if (value && value !== NEW) add({ contact_id: value })
    else setChoice(value)
  }

  return (
    <div className="space-y-2">
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      <div className="flex items-center gap-2">
        <Select value={choice} onChange={e => pick(e.target.value)} options={options} className="!w-auto" disabled={busy} />
        {busy && <span className="text-xs text-text-muted">Adding…</span>}
      </div>
      {choice === NEW && (
        <div className="rounded-xl border border-border bg-bg/60 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name"><TextInput value={form.name} autoFocus onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email"><TextInput type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
          </div>
          <Field label="Their clubs" hint="Saved with them, so they're assigned these clubs on any task.">
            <ClubPicker value={form.clubs} onChange={clubs => setForm({ ...form, clubs })} />
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => add(form)} disabled={busy || !form.name.trim() || !form.email.trim()}>Save and add</Button>
            <Button variant="ghost" onClick={() => setChoice('')}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}
