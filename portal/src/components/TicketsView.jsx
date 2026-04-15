import { useState, useEffect } from 'react'
import { getTicketEmbeds } from '../lib/api'

export default function TicketsView({ onBack }) {
  const [embeds, setEmbeds] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTicketEmbeds()
      .then(res => setEmbeds(res.embeds || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Viewing an embed — full-width iframe
  if (selected) {
    return (
      <div className="w-full flex flex-col px-8 pb-4" style={{ height: 'calc(100vh - 80px)' }}>
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-4 mb-4 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <h2 className="text-lg font-bold text-text-primary">{selected.name}</h2>
          </div>
        </div>
        <div className="flex-1 rounded-xl border border-border overflow-hidden bg-white">
          <iframe
            src={selected.iframe_url}
            title={selected.name}
            className="w-full h-full border-0"
            allow="clipboard-write"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    )
  }

  // Tile picker — always shown first
  return (
    <div className="w-full max-w-3xl mx-auto px-8 pb-12">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        <h2 className="text-lg font-bold text-text-primary">Tickets & Support</h2>
      </div>

      {loading ? (
        <p className="text-center text-text-muted text-sm py-8">Loading...</p>
      ) : embeds.length === 0 ? (
        <div className="text-center py-12">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 text-text-muted mx-auto mb-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z" />
          </svg>
          <p className="text-sm font-medium text-text-primary">No ticket forms configured yet</p>
          <p className="text-xs text-text-muted mt-1">Ask your admin to set up ticket embeds</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {embeds.map(embed => (
            <button
              key={embed.id}
              onClick={() => setSelected(embed)}
              className="group flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 min-h-[160px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
            >
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-wcs-red">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z" />
                </svg>
              </div>
              <div className="text-center">
                <span className="block text-base font-semibold text-text-primary">{embed.name}</span>
                {embed.description && (
                  <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">{embed.description}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
