import { useState, useEffect, useCallback } from 'react'
import { followUps, hub } from '../../lib/api'
import TasksSection from './TasksSection'
import GmailConnect from './GmailConnect'

// The owner's private Hub. Tasks is the first section; more sections
// (suggestions, alerts) slot into SECTIONS later.
const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const SECTIONS = [{ key: 'tasks', label: 'Tasks' }]

function TicketsCard({ count, onOpen }) {
  return (
    <button onClick={onOpen}
      className={`${CARD} w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:border-wcs-red/40 transition-colors`}>
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-text-muted">Tickets</p>
        <p className="text-sm text-text-primary mt-0.5">
          {count == null ? 'Checking…' : count === 0 ? 'Nothing open' : `${count} open ticket${count === 1 ? '' : 's'} waiting`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {count > 0 && <span className="text-2xl font-bold tabular-nums text-wcs-red">{count}</span>}
        <span className="text-sm font-semibold text-text-muted">Open tickets →</span>
      </div>
    </button>
  )
}

export default function HubView({ onBack, openTickets, onOpenTickets }) {
  const [section, setSection] = useState('tasks')
  const [gmail, setGmail] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Gmail status, then a reply check so the list opens current.
  const loadGmail = useCallback(async () => {
    try {
      const s = await followUps.status()
      setGmail(s)
      if (s.ready) {
        const { updated } = await hub.checkReplies()
        if (updated?.length) setRefreshKey(k => k + 1)
      }
    } catch { setGmail(g => g || { ready: false }) }
  }, [])
  useEffect(() => { loadGmail() }, [loadGmail])
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div className={`${CARD} px-5 py-4 flex items-center justify-between gap-3 flex-wrap`}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-text-muted hover:text-text-primary text-sm">← Back</button>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Hub</h2>
            <p className="text-xs text-text-muted">Just for you</p>
          </div>
        </div>
        {SECTIONS.length > 1 && (
          <div className="flex items-center gap-1">
            {SECTIONS.map(s => (
              <button key={s.key} onClick={() => setSection(s.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${section === s.key ? 'bg-wcs-red text-white' : 'text-text-muted hover:text-text-primary'}`}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {gmail && !gmail.ready && <GmailConnect status={gmail} onConnected={loadGmail} />}
      {onOpenTickets && <TicketsCard count={openTickets} onOpen={onOpenTickets} />}
      {section === 'tasks' && <TasksSection gmailReady={!!gmail?.ready} refreshKey={refreshKey} />}
    </div>
  )
}
