import { useState, useEffect, useCallback } from 'react'
import { hub } from '../../lib/api'
import { Select, Button, ErrorBanner } from '../adsmanager/ui'

// Attachments the 10-minute Gmail check pulled in but couldn't file on its
// own, plus reply text that can go into a text slot. Nothing is filed until
// the owner clicks File / Use.
export default function IncomingTray({ task, people, reloadKey, onChanged }) {
  const [items, setItems] = useState([])
  const [slots, setSlots] = useState([])
  const [pick, setPick] = useState({})
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [{ items: tray }, { deliverables }] = await Promise.all([hub.deliverables.tray(task.id), hub.deliverables.list(task.id)])
      setItems(tray)
      setSlots(deliverables.flatMap(d => d.slots.filter(s => s.items.length === 0).map(s => ({ id: s.id, label: s.label, kind: d.kind, personId: d.person_id }))))
      setPick(Object.fromEntries(tray.map(i => [i.id, i.suggested_slot_id || ''])))
    } catch (e) { setError(e.message) }
  }, [task.id])
  useEffect(() => { load() }, [load, reloadKey])

  const view = async id => {
    try { const { url } = await hub.deliverables.trayUrl(id); window.open(url, '_blank', 'noopener') } catch (e) { setError(e.message) }
  }
  const file = async item => {
    setError('')
    try { await hub.deliverables.fileTray(item.id, pick[item.id]); await load(); onChanged() } catch (e) { setError(e.message) }
  }
  const discard = async item => {
    if (!window.confirm(`Discard ${item.file_name}?`)) return
    try { await hub.deliverables.discardTray(item.id); await load(); onChanged() } catch (e) { setError(e.message) }
  }
  const useText = async (personId, slotId) => {
    setError('')
    try { await hub.deliverables.useReplyText(personId, slotId); await load(); onChanged() } catch (e) { setError(e.message) }
  }

  const fileSlots = mime => slots.filter(s => s.kind === 'file' || (s.kind === 'image' && /^image\//.test(mime || '')))
  const textSlots = slots.filter(s => s.kind === 'text')
  const repliers = people.filter(p => p.last_reply_at && p.gmail_thread_id)
  if (!items.length && !(textSlots.length && repliers.length)) return error ? <ErrorBanner error={error} /> : null

  return (
    <div className="space-y-2 rounded-xl border border-wcs-red/30 bg-wcs-red/5 p-3">
      <h4 className="text-xs font-bold uppercase tracking-widest text-text-primary">Incoming</h4>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-muted">From {item.person_name.split(' ')[0]}:</span>
          <button onClick={() => view(item.id)} className="text-xs font-semibold text-text-primary hover:text-wcs-red truncate max-w-[200px]">{item.file_name}</button>
          {item.suggested_slot_id && pick[item.id] === item.suggested_slot_id && <span className="text-[10px] text-text-muted">suggested</span>}
          <Select value={pick[item.id] || ''} onChange={e => setPick({ ...pick, [item.id]: e.target.value })} className="!w-auto !py-1 !text-xs ml-auto"
            options={[{ value: '', label: 'Choose a slot…' }, ...fileSlots(item.mime).map(s => ({ value: s.id, label: s.label }))]} />
          <Button className="!px-3 !py-1 !text-xs" disabled={!pick[item.id]} onClick={() => file(item)}>File</Button>
          <button onClick={() => discard(item)} className="text-[11px] text-text-muted hover:text-red-600">Discard</button>
        </div>
      ))}
      {textSlots.length > 0 && repliers.map(p => (
        <ReplyText key={p.id} person={p} slots={textSlots.filter(s => !s.personId || s.personId === p.id)} onUse={useText} />
      ))}
    </div>
  )
}

function ReplyText({ person, slots, onUse }) {
  const [slotId, setSlotId] = useState('')
  if (!slots.length) return null
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-text-muted">Use {person.name.split(' ')[0]}'s latest reply as</span>
      <Select value={slotId} onChange={e => setSlotId(e.target.value)} className="!w-auto !py-1 !text-xs"
        options={[{ value: '', label: 'Choose…' }, ...slots.map(s => ({ value: s.id, label: s.label }))]} />
      <Button variant="secondary" className="!px-3 !py-1 !text-xs" disabled={!slotId} onClick={() => onUse(person.id, slotId)}>Use</Button>
    </div>
  )
}
