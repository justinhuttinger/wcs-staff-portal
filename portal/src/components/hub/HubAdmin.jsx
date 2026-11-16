import { useState, useEffect } from 'react'
import { hub } from '../../lib/api'
import { TextInput, Button, ErrorBanner } from '../adsmanager/ui'
import SavedPeople from './SavedPeople'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'

// Hub categories: add, rename, reorder. Lives in Admin so the Hub stays work-only.
function Categories() {
  const [rows, setRows] = useState(null)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [moving, setMoving] = useState(false)

  const load = () => hub.categories.list().then(r => setRows(r.categories)).catch(e => setError(e.message))
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!name.trim()) return
    try { await hub.categories.create({ name, sort: rows?.length ?? 0 }); setName(''); load() } catch (e) { setError(e.message) }
  }
  const rename = async () => {
    try { await hub.categories.update(editing.id, { name: editing.name }); setEditing(null); load() } catch (e) { setError(e.message) }
  }
  // Swap with the neighbour; sorts are rewritten as 0..n so gaps don't matter.
  const move = async (index, dir) => {
    const next = [...rows]
    const j = index + dir
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j], next[index]]
    setRows(next)
    setMoving(true)
    // Write every position (0..n), then reload; arrows stay off until done.
    try { await Promise.all(next.map((c, i) => hub.categories.update(c.id, { sort: i }))) }
    catch (e) { setError(e.message) }
    finally { await load(); setMoving(false) }
  }

  return (
    <div className={`${CARD} p-5 space-y-3`}>
      <h3 className="text-sm font-bold text-text-primary">Task categories</h3>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      {!rows && <p className="text-xs text-text-muted">Loading…</p>}
      <div className="divide-y divide-border">
        {rows?.map((c, i) => (
          <div key={c.id} className="py-1.5 flex items-center gap-2">
            {editing?.id === c.id ? (
              <>
                <TextInput value={editing.name} autoFocus onChange={e => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') rename() }} />
                <Button variant="secondary" onClick={rename}>Save</Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-text-primary">{c.name}</span>
                <button onClick={() => move(i, -1)} disabled={moving || i === 0} className="text-xs text-text-muted hover:text-text-primary disabled:opacity-30 px-1" title="Move up">↑</button>
                <button onClick={() => move(i, 1)} disabled={moving || i === rows.length - 1} className="text-xs text-text-muted hover:text-text-primary disabled:opacity-30 px-1" title="Move down">↓</button>
                <button onClick={() => setEditing({ id: c.id, name: c.name })} className="text-xs text-text-muted hover:text-text-primary">Rename</button>
              </>
            )}
          </div>
        ))}
      </div>
      {rows?.length === 0 && <p className="text-xs text-text-muted">No categories yet.</p>}
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <TextInput value={name} placeholder="New category" onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <Button onClick={add} disabled={!name.trim() || !rows}>Add</Button>
      </div>
    </div>
  )
}

// Admin > Hub: the owner's Hub settings (categories and saved people).
export default function HubAdmin() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      <Categories />
      <div className={`${CARD} p-5`}><SavedPeople inline /></div>
    </div>
  )
}
