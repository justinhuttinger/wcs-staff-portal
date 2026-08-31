import { useState, useEffect, useCallback } from 'react'
import { ticketing } from '../lib/api'
import TicketDetail from './admin/ticketing/TicketDetail'
import TicketSubmit from './admin/ticketing/TicketSubmit'
import TicketInbox from './admin/ticketing/TicketInbox'
import { STATUS_BY_KEY, PRIORITY_BY_KEY, fmtDate } from './admin/ticketing/shared'

// Booking page for a call with Justin, served from the booking subdomain rather
// than the portal. Opened in a new tab so nobody loses the board they were
// looking at, and so the widget gets a full window instead of a portal pane.
const MEET_URL = 'https://book.westcoaststrength.com/meetjustin/'

// Staff-facing ticketing page (the "maker" experience). Everyone who can open
// it sees the status board (New by default, plus In Progress and Recently
// Completed) and can submit new tickets. Handlers additionally get a "My Queue"
// tab to work the tickets whose types they handle.
export default function TicketsBoardView({ onBack }) {
  const [canHandle, setCanHandle] = useState(false)
  const [tab, setTab] = useState('board') // board | queue
  const [view, setView] = useState(null)  // null | 'submit' | { detail: id }
  const [refreshKey, setRefreshKey] = useState(0)
  // Held here, not in TicketInbox: the detail view below unmounts the inbox, so
  // filters kept inside it were lost on every Back. See TicketInbox.jsx.
  const [filters, setFilters] = useState({ status: '', typeId: '', q: '' })
  const bump = () => setRefreshKey(k => k + 1)

  useEffect(() => { ticketing.canHandle().then(r => setCanHandle(!!r.any)).catch(() => {}) }, [])

  if (view && view.detail) {
    return (
      <div className="w-full max-w-3xl mx-auto px-8 pb-12">
        <TicketDetail ticketId={view.detail} onBack={() => setView(null)} onChanged={bump} />
      </div>
    )
  }
  if (view === 'submit') {
    return (
      <div className="w-full max-w-3xl mx-auto px-8 pb-12">
        <TicketSubmit onCancel={() => setView(null)} onDone={(id) => { bump(); setView({ detail: id }) }} />
      </div>
    )
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-8 pb-12">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6 flex items-center gap-3">
        <button onClick={onBack} className="redundant-back flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>
        <h2 className="text-lg font-bold text-text-primary">Tickets</h2>
        <div className="ml-auto flex items-center gap-2">
          {canHandle && (
            <div className="inline-flex rounded-lg border border-border bg-bg p-0.5">
              <button onClick={() => setTab('board')} className={`px-3 py-1.5 text-xs font-semibold rounded-md ${tab === 'board' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted'}`}>Board</button>
              <button onClick={() => setTab('queue')} className={`px-3 py-1.5 text-xs font-semibold rounded-md ${tab === 'queue' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted'}`}>My Queue</button>
            </div>
          )}
          {/* Some things are a conversation rather than a ticket, so the way to
              book one sits next to the way to raise one. Secondary styling so it
              does not compete with New Ticket. */}
          <a
            href={MEET_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <rect x="3" y="5" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v4M16 3v4M3 10h18" />
            </svg>
            Meet with Justin
          </a>
          <button onClick={() => setView('submit')} className="px-5 py-2.5 text-sm font-bold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 shadow-sm">+ New Ticket</button>
        </div>
      </div>

      {tab === 'queue' && canHandle
        ? <TicketInbox handling onOpen={(id) => setView({ detail: id })} refreshKey={refreshKey}
            filters={filters} onFiltersChange={setFilters} />
        : <Board onOpen={(id) => setView({ detail: id })} refreshKey={refreshKey} />}
    </div>
  )
}

function Section({ title, tint, tickets, onOpen, emptyMsg }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${tint}`} />
        <h3 className="text-sm font-bold text-text-primary">{title}</h3>
        <span className="text-xs text-text-muted">({tickets.length})</span>
      </div>
      {tickets.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyMsg}</p>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => {
            const p = PRIORITY_BY_KEY[t.priority]
            const done = t.status === 'complete'
            return (
              <button key={t.id} onClick={() => onOpen(t.id)}
                className="w-full text-left bg-bg border border-border rounded-lg px-3 py-2.5 flex items-center gap-3 hover:border-wcs-red/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-text-primary truncate">{t.title}</p>
                    {p && t.priority !== 'normal' && <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${p.chip} shrink-0`}>{p.label}</span>}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5 truncate">
                    {t.type_name} · {t.submitter_name} · {done ? `completed ${fmtDate(t.completed_at)}` : fmtDate(t.created_at)}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Board({ onOpen, refreshKey }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await ticketing.board()) } catch { /* silent */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load, refreshKey])

  if (loading && !data) return <p className="loading-card mx-auto block my-6">Loading…</p>
  if (!data) return <p className="empty-card mx-auto block my-6">Could not load tickets.</p>

  return (
    <div className="space-y-4">
      {/* Backed by a surface card — bare text is unreadable on the photo backdrop. */}
      <p className="bg-surface border border-border rounded-xl px-4 py-2 text-xs text-text-muted">Tickets you've submitted.</p>
      <Section title="New" tint={STATUS_BY_KEY.open.dot} tickets={data.open || []} onOpen={onOpen} emptyMsg="You haven't submitted any tickets yet." />
      <Section title="In Progress" tint={STATUS_BY_KEY.in_progress.dot} tickets={data.in_progress || []} onOpen={onOpen} emptyMsg="Nothing in progress." />
      <Section title={`Recently Completed`} tint={STATUS_BY_KEY.complete.dot} tickets={data.recently_completed || []} onOpen={onOpen} emptyMsg={`Nothing completed in the last ${data.window_days || 7} days.`} />
    </div>
  )
}
