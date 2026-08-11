import { useState, useEffect, useCallback } from 'react'
import { ticketing } from '../../../lib/api'
import { STATUSES, STATUS_BY_KEY, PRIORITY_BY_KEY, fmtDate } from './shared'

// The management inbox: filter chips + list of tickets. Clicking a row opens
// the detail view (handled by the parent via onOpen).
export default function TicketInbox({ onOpen, refreshKey }) {
  const [tickets, setTickets] = useState([])
  const [counts, setCounts] = useState({ open: 0, in_progress: 0, complete: 0, closed: 0 })
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [types, setTypes] = useState([])
  const [typeId, setTypeId] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { ticketing.listTypes().then(r => setTypes(r.types || [])).catch(() => {}) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, summary] = await Promise.all([
        ticketing.list({ status, type_id: typeId, q }),
        ticketing.summary(),
      ])
      setTickets(list.tickets || [])
      setCounts(summary.counts || {})
      setTotal(summary.total || 0)
    } catch { /* silent */ } finally { setLoading(false) }
  }, [status, typeId, q])
  useEffect(() => { load() }, [load, refreshKey])

  const filters = [
    { key: '', label: `All (${total})` },
    ...STATUSES.map(s => ({ key: s.key, label: `${s.label} (${counts[s.key] || 0})`, dot: s.dot })),
  ]

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map(f => (
          <button key={f.key || 'all'} onClick={() => setStatus(f.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg border transition-colors ${status === f.key ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}>
            {f.dot && <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />}
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={typeId} onChange={e => setTypeId(e.target.value)}
          className="px-3 py-1.5 text-sm bg-bg border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red">
          <option value="">All types</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title…"
          className="px-3 py-1.5 text-sm bg-bg border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red flex-1 min-w-[160px]" />
      </div>

      {loading ? (
        <p className="loading-card mx-auto block my-6">Loading…</p>
      ) : tickets.length === 0 ? (
        <div className="text-center py-10 bg-surface border border-border rounded-xl">
          <p className="text-sm text-text-muted">No tickets{status ? ` with status “${STATUS_BY_KEY[status]?.label}”` : ''} yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => {
            const s = STATUS_BY_KEY[t.status] || STATUS_BY_KEY.open
            const p = PRIORITY_BY_KEY[t.priority]
            return (
              <button key={t.id} onClick={() => onOpen(t.id)}
                className="w-full text-left bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3 hover:border-wcs-red/50 hover:shadow-sm transition-all">
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} title={s.label} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-text-primary truncate">{t.title}</p>
                    {p && t.priority !== 'normal' && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${p.chip} shrink-0`}>{p.label}</span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5 truncate">
                    {t.type_name} · {t.submitter_name} · {fmtDate(t.created_at)}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${s.chip} shrink-0`}>{s.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
