import React, { useState, useEffect } from 'react'
import { getTicketEmbeds } from '../../lib/api'
import MobileTicketsStatus from './MobileTicketsStatus'
import MobileLoading from './MobileLoading'

const STATUS_TILE = {
  kind: 'tickets-status',
  id: 'tickets-status',
  name: 'Ticket Status',
  description: 'In Progress',
}

const BOOK_MEETING_TILE = {
  id: 'book-meeting-justin',
  name: 'Book a Meeting with Justin',
  iframe_url: 'https://api.westcoaststrength.com/widget/group/Xdv87CClIXaznbgqoRgq',
  description: 'Calendar',
}

function StatusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  )
}

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-wcs-red">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z" />
    </svg>
  )
}

function Tile({ icon, label, description, onClick }) {
  return (
    <button
      onClick={onClick}
      className="bg-surface border border-border rounded-2xl shadow-sm p-5 flex flex-col items-center justify-center gap-3 active:scale-95 transition-transform"
    >
      <div className="w-12 h-12 rounded-full bg-bg flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="text-center min-h-[2.5rem]">
        <span className="block text-sm font-semibold text-text-primary leading-tight">{label}</span>
        {description && (
          <span className="block text-[10px] font-medium text-text-muted uppercase tracking-wide mt-1">{description}</span>
        )}
      </div>
    </button>
  )
}

export default function MobileTickets() {
  const [embeds, setEmbeds] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTicketEmbeds()
      .then(res => setEmbeds(res.embeds || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Built-in: ClickUp ticket status dashboard
  if (selected?.kind === 'tickets-status') {
    return <MobileTicketsStatus onBack={() => setSelected(null)} />
  }

  // Viewing an embed — full-width iframe with bubble header
  if (selected) {
    return (
      <div className="flex flex-col h-full bg-bg">
        <div className="px-4 pt-4 pb-2">
          <div className="bg-surface border border-border rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3">
            <button
              onClick={() => setSelected(null)}
              className="flex items-center justify-center w-9 h-9 -ml-1 rounded-lg active:bg-bg transition-colors"
              aria-label="Go back"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-text-primary">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <h2 className="text-lg font-bold text-text-primary truncate flex-1">{selected.name}</h2>
          </div>
        </div>
        <div className="flex-1 px-4 pb-4">
          <div className="h-full rounded-2xl border border-border overflow-hidden bg-white shadow-sm">
            <iframe
              src={selected.iframe_url}
              title={selected.name}
              className="w-full h-full border-0"
              allow="clipboard-write"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </div>
    )
  }

  // Tile picker
  return (
    <div className="px-4 pt-4 pb-8">
      <div className="bg-surface border border-border rounded-2xl shadow-sm p-4 mb-4">
        <h2 className="text-lg font-bold text-text-primary">Tickets & Support</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tile
          icon={<StatusIcon />}
          label="Ticket Status"
          description="In Progress"
          onClick={() => setSelected(STATUS_TILE)}
        />
        <Tile
          icon={<CalendarIcon />}
          label="Book a Meeting with Justin"
          description="Calendar"
          onClick={() => setSelected(BOOK_MEETING_TILE)}
        />
        {!loading && embeds.map(embed => (
          <Tile
            key={embed.id}
            icon={<TicketIcon />}
            label={embed.name}
            description={embed.description}
            onClick={() => setSelected(embed)}
          />
        ))}
      </div>

      {loading && (
        <div className="mt-4">
          <MobileLoading variant="list" count={2} className="px-0 py-0" />
        </div>
      )}
    </div>
  )
}
