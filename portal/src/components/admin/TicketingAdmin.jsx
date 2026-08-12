import { useState } from 'react'
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

      {tab === 'inbox'
        ? <TicketInbox onOpen={(id) => setView({ detail: id })} refreshKey={refreshKey} />
        : <TicketTypeBuilder />}
    </div>
  )
}
