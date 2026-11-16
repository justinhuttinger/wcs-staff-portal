import { useState, useEffect, useCallback } from 'react'
import { followUps, hub } from '../../lib/api'
import TasksSection from './TasksSection'
import GmailConnect from './GmailConnect'
import SavedPeople from './SavedPeople'
import OpenTickets from './OpenTickets'
import IssuesStrip from './IssuesStrip'
import { isGmailDisconnected, markGmailLost } from './gmailState'

// The owner's private Hub, laid out as a dashboard: issues across the top,
// open tickets on the left, tasks on the right. Below the lg breakpoint the
// columns stack (tickets, then tasks).
const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'

export default function HubView({ onBack }) {
  const [gmail, setGmail] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showPeople, setShowPeople] = useState(false)
  // An open ticket takes the full width; the tasks column waits underneath.
  const [ticketOpen, setTicketOpen] = useState(false)
  // Filled by the Alerts project; the strip renders nothing while empty.
  const [issues] = useState([])

  // Gmail status, then a reply check so the list opens current.
  const loadGmail = useCallback(async () => {
    try {
      const s = await followUps.status()
      setGmail(s)
      if (s.ready) {
        const { updated } = await hub.checkReplies()
        if (updated?.length) setRefreshKey(k => k + 1)
      }
    } catch (e) {
      // A revoked grant answers 412: bring the connect card back.
      if (isGmailDisconnected(e)) setGmail(markGmailLost)
      else setGmail(g => g || { ready: false })
    }
  }, [])
  const onGmailLost = useCallback(() => setGmail(markGmailLost), [])
  useEffect(() => { loadGmail() }, [loadGmail])

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      <div className={`${CARD} px-5 py-4 flex items-center justify-between gap-3 flex-wrap`}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-text-muted hover:text-text-primary text-sm">← Back</button>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Hub</h2>
            <p className="text-xs text-text-muted">Just for you</p>
          </div>
        </div>
        <button onClick={() => setShowPeople(true)}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-bg border border-border text-text-primary hover:bg-border/40">Saved people</button>
      </div>

      <IssuesStrip issues={issues} />
      {gmail && !gmail.ready && <GmailConnect status={gmail} onConnected={loadGmail} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className={ticketOpen ? 'lg:col-span-3' : 'lg:col-span-1'}>
          <OpenTickets onOpenChange={setTicketOpen} />
        </div>
        <div className={ticketOpen ? 'lg:col-span-3' : 'lg:col-span-2'}>
          <TasksSection gmailReady={!!gmail?.ready} refreshKey={refreshKey} onGmailLost={onGmailLost} />
        </div>
      </div>

      {showPeople && <SavedPeople onClose={() => setShowPeople(false)} />}
    </div>
  )
}
