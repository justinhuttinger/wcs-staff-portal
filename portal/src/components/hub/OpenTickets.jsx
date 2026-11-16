import { useState, useEffect, useCallback } from 'react'
import { ticketing } from '../../lib/api'
import TicketDetail from '../admin/ticketing/TicketDetail'
import { ErrorBanner, Spinner } from '../adsmanager/ui'
import { openTicketsFirst } from './ticketFilter'
import { ago } from './dates'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const STATUS = {
  open: { text: 'Open', tone: 'text-wcs-red bg-wcs-red/10 border-wcs-red/30' },
  in_progress: { text: 'In progress', tone: 'text-amber-700 bg-amber-500/10 border-amber-500/30' },
}

// Left column of the Hub: every ticket still being worked. Clicking one opens
// it right here (same screen as the ticket board), Back returns to the list.
export default function OpenTickets({ onCount }) {
  const [rows, setRows] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const { tickets } = await ticketing.list()
      const live = openTicketsFirst(tickets)
      setRows(live)
      onCount?.(live.length)
    } catch (e) { setError(e.message) }
  }, [onCount])
  useEffect(() => { load() }, [load])

  if (openId) {
    return (
      <div className={`${CARD} p-3`}>
        <TicketDetail ticketId={openId} onBack={() => { setOpenId(null); load() }} onChanged={load} />
      </div>
    )
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-text-primary">Open tickets</h3>
        <span className="text-[11px] text-text-muted">{rows ? rows.length : ''}</span>
      </div>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <p className="px-4 py-6 text-sm text-text-muted">Nothing open.</p>}
      <div className="divide-y divide-border max-h-[70vh] overflow-y-auto">
        {rows?.map(t => {
          const s = STATUS[t.status] || STATUS.open
          return (
            <button key={t.id} onClick={() => setOpenId(t.id)} className="w-full text-left px-4 py-2.5 hover:bg-bg/60">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-text-primary line-clamp-2">{t.title || t.type_name}</p>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.tone}`}>{s.text}</span>
              </div>
              <p className="text-[11px] text-text-muted truncate mt-0.5">
                {[t.type_name, t.submitter_name, ago(t.created_at)].filter(Boolean).join(' · ')}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
