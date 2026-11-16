import { useState, useEffect, useCallback } from 'react'
import { hub } from '../../lib/api'
import { CLUBS } from '../../config/locations'
import { TextInput, Select, Button, ErrorBanner } from '../adsmanager/ui'
import { gridColumns } from './gridColumns'

const KIND_OPTIONS = [
  { value: 'image', label: 'Photo / image' },
  { value: 'file', label: 'Any file' },
  { value: 'text', label: 'Text (copy)' },
]
const CLUB_NAME = slug => (slug ? CLUBS.find(c => c.slug === slug)?.name || slug : '')

function Item({ item, onChanged, onError }) {
  const [open, setOpen] = useState(false)
  const markSeen = () => { if (item.is_new) hub.deliverables.itemSeen(item.id).then(onChanged).catch(() => {}) }
  const view = async () => {
    try {
      if (item.text_body != null) { setOpen(o => !o) } else {
        const { url } = await hub.deliverables.itemUrl(item.id)
        window.open(url, '_blank', 'noopener')
      }
      markSeen()
    } catch (e) { onError(e.message) }
  }
  const clear = async () => {
    if (!window.confirm('Remove this from the slot?')) return
    try { await hub.deliverables.removeItem(item.id); onChanged() } catch (e) { onError(e.message) }
  }
  const label = item.text_body != null ? (open ? 'Hide text' : 'Text') : (item.file_name || 'File')
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <button onClick={view} className="text-xs font-semibold text-text-primary hover:text-wcs-red truncate max-w-[140px]" title={item.file_name || ''}>
          {label}
        </button>
        {item.is_new && <span className="px-1.5 rounded-full text-[9px] font-bold bg-wcs-red text-white">NEW</span>}
        <button onClick={clear} className="text-[11px] text-text-muted hover:text-red-600 ml-auto" title="Remove">×</button>
      </div>
      {open && <p className="text-xs whitespace-pre-wrap text-text-primary rounded border border-border bg-bg p-2">{item.text_body}</p>}
    </div>
  )
}

function Cell({ slot, kind, ownerOptions, onOwner, onAuto, onChanged, onError }) {
  const [busy, setBusy] = useState(false)
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')
  const addFile = async file => {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await hub.deliverables.addItem(slot.id, fd)
      onChanged()
    } catch (e) { onError(e.message) } finally { setBusy(false) }
  }
  const addText = async () => {
    setBusy(true)
    try { await hub.deliverables.addItem(slot.id, { text }); setText(''); setWriting(false); onChanged() }
    catch (e) { onError(e.message) } finally { setBusy(false) }
  }
  return (
    <td className="align-top px-3 py-2 border-l border-border min-w-[150px]">
      <Select value={slot.person_id || ''} onChange={e => onOwner(slot.id, e.target.value)} options={ownerOptions}
        className="!py-0.5 !px-1.5 !text-[11px] !w-full" />
      {slot.owner_manual && slot.club
        ? <button onClick={() => onAuto(slot.id)} className="block text-[10px] text-text-muted hover:text-text-primary mb-1.5" title="Assign by who covers this club">set by hand · use clubs</button>
        : <div className="mb-1.5" />}
      {slot.items.length === 0 && <p className="text-[11px] text-text-muted">○ waiting</p>}
      <div className="space-y-1.5">{slot.items.map(i => <Item key={i.id} item={i} onChanged={onChanged} onError={onError} />)}</div>
      {kind === 'text' ? (
        writing ? (
          <div className="mt-1.5 space-y-1">
            <textarea rows={3} value={text} onChange={e => setText(e.target.value)}
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text-primary" />
            <div className="flex gap-2">
              <button onClick={addText} disabled={!text.trim() || busy} className="text-[11px] font-semibold text-wcs-red disabled:opacity-40">Save</button>
              <button onClick={() => setWriting(false)} className="text-[11px] text-text-muted">Cancel</button>
            </div>
          </div>
        ) : <button onClick={() => setWriting(true)} className="mt-1 text-[11px] text-text-muted hover:text-text-primary">+ add text</button>
      ) : (
        <label className="mt-1 inline-block text-[11px] text-text-muted hover:text-text-primary cursor-pointer">
          {busy ? 'Uploading…' : '+ add file'}
          <input type="file" className="hidden" accept={kind === 'image' ? 'image/*' : undefined}
            onChange={e => { addFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      )}
    </td>
  )
}

export default function DeliverablesGrid({ task, people, reloadKey = 0, onChanged }) {
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState({ name: '', kind: 'image', person_id: '' })
  const [error, setError] = useState('')
  const closed = task.status === 'done' || task.status === 'dropped'

  const load = useCallback(async () => {
    try { setRows((await hub.deliverables.list(task.id)).deliverables) } catch (e) { setError(e.message) }
  }, [task.id])
  useEffect(() => { load() }, [load, task.clubs.join(','), reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const changed = () => { onChanged?.() }
  const add = async () => {
    setError('')
    try {
      const { deliverables } = await hub.deliverables.create(task.id, { ...form, person_id: form.person_id || null })
      setRows(deliverables); setForm({ ...form, name: '' }); onChanged?.()
    } catch (e) { setError(e.message) }
  }
  const setOwner = async (slotId, personId) => {
    try { setRows((await hub.deliverables.setSlotOwner(slotId, personId)).deliverables); onChanged?.() }
    catch (e) { setError(e.message) }
  }
  const autoOwner = async slotId => {
    try { setRows((await hub.deliverables.autoSlotOwner(slotId)).deliverables); onChanged?.() }
    catch (e) { setError(e.message) }
  }
  const remove = async d => {
    if (!window.confirm(`Delete "${d.name}" and anything already in it?`)) return
    try { setRows((await hub.deliverables.remove(d.id)).deliverables); onChanged?.() } catch (e) { setError(e.message) }
  }

  const columns = gridColumns(task.clubs, rows || [])
  const personOptions = [{ value: '', label: 'Nobody yet' }, ...people.map(p => ({ value: p.id, label: p.name }))]
  const ownerOptions = [{ value: '', label: 'Unassigned' }, ...people.map(p => ({ value: p.id, label: p.name }))]

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-bold uppercase tracking-widest text-text-muted">Deliverables</h4>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg/60">
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-text-muted">Item</th>
                {columns.map(({ club, removed }) => (
                  <th key={club || 'none'} className="text-left px-3 py-2 text-[11px] font-semibold text-text-muted border-l border-border">
                    {CLUB_NAME(club) || (removed ? 'Before clubs' : 'Received')}{removed && club ? ' (removed)' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(d => (
                <tr key={d.id}>
                  <td className="align-top px-3 py-2 min-w-[170px]">
                    <p className="text-sm font-semibold text-text-primary">{d.name}</p>
                    <p className="text-[11px] text-text-muted">{KIND_OPTIONS.find(k => k.value === d.kind)?.label}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => remove(d)} className="text-[11px] text-text-muted hover:text-red-600">Delete</button>
                    </div>
                  </td>
                  {columns.map(({ club: c }) => {
                    const slot = d.slots.find(s => (s.club ?? null) === c)
                    return slot
                      ? <Cell key={slot.id} slot={slot} kind={d.kind} ownerOptions={ownerOptions} onOwner={setOwner} onAuto={autoOwner} onChanged={changed} onError={setError} />
                      : <td key={c || 'none'} className="border-l border-border" />
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length === 0 && <p className="text-xs text-text-muted">Nothing expected back yet. Add what you need, like a photo or copy{task.clubs.length > 1 ? '; each club gets its own slot' : ''}.</p>}
      {!closed && (
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[160px]"><TextInput value={form.name} placeholder="e.g. Photo, Copy, Flyer" onChange={e => setForm({ ...form, name: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && form.name.trim()) add() }} /></div>
          <Select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} options={KIND_OPTIONS} className="!w-auto" />
          {task.clubs.length === 0 && (
            <Select value={form.person_id} onChange={e => setForm({ ...form, person_id: e.target.value })} options={personOptions} className="!w-auto" />
          )}
          <Button variant="secondary" onClick={add} disabled={!form.name.trim()}>Add</Button>
        </div>
      )}
    </div>
  )
}
