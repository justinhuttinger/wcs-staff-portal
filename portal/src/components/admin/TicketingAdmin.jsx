import { useState, useEffect, useCallback } from 'react'
import { googleChat } from '../../lib/api'
import { connectGoogleChat } from '../../lib/googleChatConnect'
import TicketInbox from './ticketing/TicketInbox'
import TicketDetail from './ticketing/TicketDetail'
import TicketSubmit from './ticketing/TicketSubmit'
import TicketTypeBuilder from './ticketing/TicketTypeBuilder'

// Native ticketing tool (admin). Replaces the ClickUp form embeds with a
// self-hosted submit → track → complete workflow plus a form-builder for
// ticket types. Admin-only for now; widen via RBAC when ready.
export default function TicketingAdmin() {
  const [tab, setTab] = useState('inbox') // inbox | types
  const [view, setView] = useState(null)  // null | 'submit' | { detail: id }
  const [refreshKey, setRefreshKey] = useState(0)
  // Held here, not in TicketInbox: the detail view below unmounts the inbox, so
  // filters kept inside it were lost on every Back. See TicketInbox.jsx.
  const [filters, setFilters] = useState({ status: '', typeId: '', q: '' })

  const bump = () => setRefreshKey(k => k + 1)

  // Detail view
  if (view && view.detail) {
    return <TicketDetail ticketId={view.detail} onBack={() => setView(null)} onChanged={bump} />
  }
  // Submit view
  if (view === 'submit') {
    return (
      <TicketSubmit
        onCancel={() => setView(null)}
        onDone={(id) => { bump(); setView({ detail: id }) }}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex rounded-lg border border-border bg-bg p-0.5">
          <button onClick={() => setTab('inbox')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${tab === 'inbox' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
            Tickets
          </button>
          <button onClick={() => setTab('types')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${tab === 'types' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
            Ticket Types
          </button>
        </div>
        {tab === 'inbox' && (
          <button onClick={() => setView('submit')}
            className="px-5 py-2.5 text-sm font-bold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 shadow-sm">
            + New Ticket
          </button>
        )}
      </div>

      {tab === 'types' && <NotifierStatus />}

      {tab === 'inbox'
        ? <TicketInbox onOpen={(id) => setView({ detail: id })} refreshKey={refreshKey}
            filters={filters} onFiltersChange={setFilters} />
        : <TicketTypeBuilder />}
    </div>
  )
}

// The shared Google account that ticket-creation notices are sent from. Each
// ticket type picks WHO gets notified; this is WHO IT COMES FROM. Without it
// linked, creation notices are recorded as failed and nothing is delivered.
function NotifierStatus() {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    googleChat.systemStatus().then(setStatus).catch(() => setStatus(null))
  }, [])
  useEffect(() => { load() }, [load])

  async function connect() {
    setBusy(true)
    try {
      await connectGoogleChat({ system: true })
      load()
    } finally { setBusy(false) }
  }

  if (!status) return null

  const ok = status.connected && status.has_chat
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-green-500' : 'bg-amber-500'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary">
          {ok ? `New-ticket notices send from ${status.email}` : 'New-ticket notices are not being delivered'}
        </p>
        <p className="text-xs text-text-muted mt-0.5">
          {!status.connected
            ? `Connect ${status.expected_email} once so the portal can DM people when a ticket is created.`
            : !status.has_chat
              ? `${status.email} is linked but did not grant Google Chat permission — reconnect and allow it.`
              : status.matches_expected
                ? 'Each ticket type chooses who receives them.'
                : `Linked as ${status.email}, not the configured ${status.expected_email}.`}
        </p>
      </div>
      <button onClick={connect} disabled={busy}
        className="px-4 py-2 text-xs font-semibold rounded-lg border border-border bg-bg text-text-primary hover:border-wcs-red hover:text-wcs-red disabled:opacity-40 shrink-0">
        {busy ? 'Connecting…' : status.connected ? 'Reconnect' : 'Connect sender'}
      </button>
    </div>
  )
}
