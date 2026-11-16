import { useState, useEffect, useCallback } from 'react'
import { hub } from '../../lib/api'
import { ago } from './dates'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const ICON = { ticket: '🎫', deliverable: '📎', reply: '✉', tray: '📥', suggestion: '💡' }

// Top of the Hub: everything new the owner hasn't opened. Clicking a line opens
// it; it disappears once opened (tickets) or once its own flag clears
// (deliverable viewed, reply seen, file filed). Reloads when reloadKey changes
// and every minute.
export default function NewFeed({ reloadKey = 0, onOpenTicket, onOpenTask }) {
  const [items, setItems] = useState(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    hub.newFeed().then(r => { setItems(r.items); setFailed(false) }).catch(() => setFailed(true))
  }, [])
  useEffect(() => { load() }, [load, reloadKey])
  useEffect(() => {
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  if (!items) {
    return failed ? <div className={`${CARD} px-5 py-2.5 text-xs text-text-muted`}>Couldn't load what's new. Retrying…</div> : null
  }
  if (!items.length) {
    return <div className={`${CARD} px-5 py-2.5 text-xs text-text-muted`}>Nothing new</div>
  }
  const open = item => {
    if (item.ticketId) {
      setItems(list => list.filter(x => x.key !== item.key))
      onOpenTicket(item.ticketId)
    } else if (item.taskId) {
      onOpenTask(item.taskId)
    }
  }
  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="px-5 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-text-primary">New <span className="text-wcs-red">({items.length})</span></h3>
      </div>
      <div className="divide-y divide-border max-h-64 overflow-y-auto">
        {items.map(item => (
          <button key={item.key} onClick={() => open(item)} className="w-full text-left px-5 py-2 hover:bg-bg/60 flex items-center gap-3">
            <span className="shrink-0 w-5 text-center">{ICON[item.kind] || '•'}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
              <span className="font-semibold">{item.text}</span>
              {item.sub && <span className="text-text-muted"> · {item.sub}</span>}
            </span>
            <span className="shrink-0 text-[11px] text-text-muted">{ago(item.at)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
