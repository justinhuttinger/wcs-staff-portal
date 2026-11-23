import { useState, useEffect, useCallback } from 'react'
import { projects } from '../../lib/api'
import { Button, ErrorBanner, Spinner, Select, TextInput } from '../adsmanager/ui'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'

// Admin > Projects: who has the Projects tile, and the task categories.
export default function ProjectsAdmin() {
  const [members, setMembers] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [pick, setPick] = useState('')
  const [categories, setCategories] = useState(null)
  const [newCat, setNewCat] = useState('')
  const [renaming, setRenaming] = useState(null) // { id, name }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([projects.members.list(), projects.categories.list()])
      setMembers(m.members); setCandidates(m.candidates); setCategories(c.categories)
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const run = async fn => {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const addMember = () => run(async () => { await projects.members.add(pick); setPick(''); await load() })
  const removeMember = id => run(async () => { await projects.members.remove(id); await load() })
  const addCategory = () => run(async () => {
    await projects.categories.create({ name: newCat, sort: (categories?.length || 0) + 1 })
    setNewCat(''); await load()
  })
  const renameCategory = () => run(async () => {
    await projects.categories.update(renaming.id, { name: renaming.name })
    setRenaming(null); await load()
  })

  if (!members && !error) return <div className={CARD}><Spinner /></div>

  return (
    <div className="space-y-5 max-w-3xl">
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      <div className={`${CARD} p-5 space-y-4`}>
        <div>
          <h3 className="text-sm font-bold text-text-primary">Members</h3>
          <p className="text-xs text-text-muted mt-0.5">Members see the Projects tile, see every task, and can be assigned. Removing someone keeps their past tasks.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={pick} onChange={e => setPick(e.target.value)} className="!w-auto min-w-[240px]"
            options={[{ value: '', label: 'Add a staff member…' }, ...candidates.map(s => ({ value: s.id, label: `${s.name} (${s.email})` }))]} />
          <Button onClick={addMember} disabled={!pick || busy}>Add</Button>
        </div>
        {members?.length === 0 && <p className="text-sm text-text-muted">No members yet.</p>}
        {members?.length > 0 && (
          <div className="divide-y divide-border border border-border rounded-lg">
            {members.map(m => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                  <p className="text-[11px] text-text-muted truncate">{m.email}</p>
                </div>
                <Button variant="ghost" onClick={() => removeMember(m.id)} disabled={busy}>Remove</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`${CARD} p-5 space-y-4`}>
        <div>
          <h3 className="text-sm font-bold text-text-primary">Categories</h3>
          <p className="text-xs text-text-muted mt-0.5">Used to filter tasks and group the timeline.</p>
        </div>
        <div className="flex gap-2">
          <TextInput value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category"
            onKeyDown={e => { if (e.key === 'Enter' && newCat.trim() && !busy) addCategory() }} className="!w-64" />
          <Button onClick={addCategory} disabled={!newCat.trim() || busy}>Add</Button>
        </div>
        {categories?.length > 0 && (
          <div className="divide-y divide-border border border-border rounded-lg">
            {categories.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2">
                {renaming?.id === c.id ? (
                  <>
                    <TextInput value={renaming.name} autoFocus onChange={e => setRenaming({ ...renaming, name: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter' && renaming.name.trim()) renameCategory(); if (e.key === 'Escape') setRenaming(null) }}
                      className="!py-1 !text-sm" />
                    <div className="flex gap-1">
                      <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                      <Button onClick={renameCategory} disabled={!renaming.name.trim() || busy}>Save</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-text-primary">{c.name}</p>
                    <Button variant="ghost" onClick={() => setRenaming({ id: c.id, name: c.name })}>Rename</Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
