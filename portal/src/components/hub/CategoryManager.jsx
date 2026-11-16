import { useState } from 'react'
import { hub } from '../../lib/api'
import { Modal, TextInput, Button, ErrorBanner } from '../adsmanager/ui'

// Add and rename the owner's task categories.
export default function CategoryManager({ categories, onClose, onChange }) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  const add = async () => {
    if (!name.trim()) return
    setError('')
    try {
      const { category } = await hub.categories.create({ name, sort: categories.length })
      onChange([...categories, category]); setName('')
    } catch (e) { setError(e.message) }
  }
  const rename = async () => {
    setError('')
    try {
      const { category } = await hub.categories.update(editing.id, { name: editing.name })
      onChange(categories.map(c => c.id === category.id ? category : c)); setEditing(null)
    } catch (e) { setError(e.message) }
  }

  return (
    <Modal title="Categories" onClose={onClose} footer={<Button variant="ghost" onClick={onClose}>Done</Button>}>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      <div className="space-y-2">
        {categories.map(c => (
          <div key={c.id} className="flex items-center gap-2">
            {editing?.id === c.id ? (
              <>
                <TextInput value={editing.name} autoFocus onChange={e => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') rename() }} />
                <Button variant="secondary" onClick={rename}>Save</Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-text-primary">{c.name}</span>
                <button onClick={() => setEditing({ id: c.id, name: c.name })}
                  className="text-xs text-text-muted hover:text-text-primary">Rename</button>
              </>
            )}
          </div>
        ))}
        {categories.length === 0 && <p className="text-xs text-text-muted">No categories yet.</p>}
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <TextInput value={name} placeholder="New category" onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <Button onClick={add} disabled={!name.trim()}>Add</Button>
      </div>
    </Modal>
  )
}
