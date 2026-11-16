import { useState, useEffect } from 'react'
import { hub } from '../../lib/api'
import { CLUBS } from '../../config/locations'
import { Modal, Field, TextInput, Button, ErrorBanner } from '../adsmanager/ui'
import { ClubPicker } from './TaskEditor'

const CLUB_NAME = slug => CLUBS.find(c => c.slug === slug)?.name || slug

// The owner's saved people: name, email and the clubs they cover.
export default function SavedPeople({ onClose }) {
  const [contacts, setContacts] = useState(null)
  const [editing, setEditing] = useState(null) // contact being edited, or {} for new
  const [error, setError] = useState('')

  const load = () => hub.contacts.list().then(r => setContacts(r.contacts)).catch(e => setError(e.message))
  useEffect(() => { load() }, [])

  const save = async () => {
    setError('')
    try {
      const body = { name: editing.name, email: editing.email, clubs: editing.clubs || [] }
      if (editing.id) await hub.contacts.update(editing.id, body)
      else await hub.contacts.create(body)
      setEditing(null); load()
    } catch (e) { setError(e.message) }
  }
  const remove = async c => {
    if (!window.confirm(`Remove ${c.name} from saved people? Tasks they're on keep them.`)) return
    try { await hub.contacts.remove(c.id); load() } catch (e) { setError(e.message) }
  }

  return (
    <Modal title="Saved people" subtitle="People you ask for things, with their clubs" onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>Done</Button>}>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name"><TextInput value={editing.name || ''} autoFocus onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Email"><TextInput type="email" value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} /></Field>
          </div>
          <Field label="Their clubs"><ClubPicker value={editing.clubs || []} onChange={clubs => setEditing({ ...editing, clubs })} /></Field>
          <div className="flex gap-2">
            <Button onClick={save} disabled={!editing.name?.trim() || !editing.email?.trim()}>Save</Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          {!contacts && <p className="text-xs text-text-muted">Loading…</p>}
          {contacts?.length === 0 && <p className="text-xs text-text-muted">Nobody saved yet. People you add to tasks are saved here.</p>}
          <div className="divide-y divide-border">
            {contacts?.map(c => (
              <div key={c.id} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">{c.name}</p>
                  <p className="text-[11px] text-text-muted truncate">{c.email}{c.clubs.length ? ` · ${c.clubs.map(CLUB_NAME).join(', ')}` : ''}</p>
                </div>
                <button onClick={() => setEditing(c)} className="text-xs text-text-muted hover:text-text-primary">Edit</button>
                <button onClick={() => remove(c)} className="text-xs text-text-muted hover:text-red-600">Remove</button>
              </div>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setEditing({ name: '', email: '', clubs: [] })}>+ New person</Button>
        </>
      )}
    </Modal>
  )
}
