import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

const CLUB_NUMBERS = [
  { slug: 'salem', name: 'Salem', clubNumber: '30935' },
  { slug: 'keizer', name: 'Keizer', clubNumber: '31599' },
  { slug: 'eugene', name: 'Eugene', clubNumber: '7655' },
  { slug: 'springfield', name: 'Springfield', clubNumber: '31598' },
  { slug: 'clackamas', name: 'Clackamas', clubNumber: '31600' },
  { slug: 'milwaukie', name: 'Milwaukie', clubNumber: '31601' },
  { slug: 'medford', name: 'Medford', clubNumber: '32073' },
]

function todayLocalISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtTimeLocal(ts) {
  if (!ts) return ''
  // event_timestamp_local is "YYYY-MM-DDTHH:mm:ss" Pacific local
  const m = String(ts).match(/T(\d{2}):(\d{2})/)
  if (!m) return ts
  let hour = parseInt(m[1], 10)
  const min = m[2]
  const ampm = hour >= 12 ? 'PM' : 'AM'
  hour = hour % 12 || 12
  return `${hour}:${min} ${ampm}`
}

function statusBadge(status, attended) {
  // attended_status takes precedence when set
  const s = (attended || status || '').toLowerCase()
  if (s.includes('did not attend') || s.includes('no show') || s.includes('no-show')) {
    return { label: 'No Show', cls: 'bg-red-50 text-red-700 border-red-200' }
  }
  if (s.includes('cancel')) {
    return { label: status || 'Canceled', cls: 'bg-orange-50 text-orange-700 border-orange-200' }
  }
  if (s.includes('completed') || s.includes('attended')) {
    return { label: 'Completed', cls: 'bg-green-50 text-green-700 border-green-200' }
  }
  if (s.includes('pending') || s.includes('scheduled')) {
    return { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
  }
  return { label: status || 'Unknown', cls: 'bg-gray-50 text-gray-700 border-gray-200' }
}

function SessionBalanceModal({ event, clubNumber, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams({
          club_number: clubNumber,
          member_id: event.member_id,
          event_type_id: event.event_type_id || '',
        }).toString()
        const r = await api('/abc-scheduler/session-balance?' + qs)
        if (!cancelled) setData(r)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load session balance')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (event?.member_id) load()
    return () => { cancelled = true }
  }, [event, clubNumber])

  const summaries = data?.serviceSummaries || []
  const matched = event?.event_type_id
    ? summaries.filter(s => s.eventId === event.event_type_id || s.serviceName?.toLowerCase().includes((event.event_name || '').toLowerCase()))
    : summaries

  const clientName = [event.member_first_name, event.member_last_name].filter(Boolean).join(' ') || '—'
  const trainerName = [event.employee_first_name, event.employee_last_name].filter(Boolean).join(' ') || '—'
  const badge = statusBadge(event.status, event.attended_status)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{event.event_name || 'Appointment'}</h3>
            <p className="text-xs text-text-muted mt-0.5">{fmtTimeLocal(event.event_timestamp_local)} · {event.duration_minutes || '?'} min · {trainerName}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between bg-bg rounded-lg px-3 py-2">
            <span className="text-xs text-text-muted">Client</span>
            <span className="text-sm font-semibold text-text-primary">{clientName}</span>
          </div>
          <div className="flex items-center justify-between bg-bg rounded-lg px-3 py-2">
            <span className="text-xs text-text-muted">Status</span>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
          </div>
          {event.training_level && (
            <div className="flex items-center justify-between bg-bg rounded-lg px-3 py-2">
              <span className="text-xs text-text-muted">Training Level</span>
              <span className="text-sm text-text-primary">{event.training_level}</span>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Session Balance</p>
          {loading && <p className="text-xs text-text-muted">Loading from ABC…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {!loading && !error && matched.length === 0 && (
            <p className="text-xs text-text-muted">No matching service purchase found.</p>
          )}
          {!loading && !error && matched.map((s, i) => (
            <div key={i} className="bg-bg rounded-lg p-3 mb-2 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-text-primary">{s.serviceName}</span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${parseInt(s.available || 0) > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {s.available || 0} left
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-[11px] text-text-muted">
                <span><span className="text-text-primary font-medium">{s.purchased}</span> purchased</span>
                <span><span className="text-text-primary font-medium">{s.scheduled}</span> scheduled</span>
                <span><span className="text-text-primary font-medium">{s.available}</span> available</span>
                <span><span className="text-text-primary font-medium">{s.unscheduled}</span> unscheduled</span>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-text-muted mt-3 italic">Phase 1: viewer only. Booking + attendance status changes coming in a later phase.</p>
      </div>
    </div>
  )
}

export default function PtSchedulerView() {
  const [club, setClub] = useState(CLUB_NUMBERS[0])
  const [date, setDate] = useState(todayLocalISO())
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const qs = new URLSearchParams({
          club_number: club.clubNumber,
          start: date, end: date, category: 'Appointment',
        }).toString()
        const r = await api('/abc-scheduler/events?' + qs)
        if (!cancelled) setEvents(r.events || [])
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load events')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [club, date])

  // Group by trainer
  const byTrainer = {}
  for (const e of events) {
    const key = e.employee_id || 'unassigned'
    if (!byTrainer[key]) {
      byTrainer[key] = {
        name: [e.employee_first_name, e.employee_last_name].filter(Boolean).join(' ') || 'Unassigned',
        events: [],
      }
    }
    byTrainer[key].events.push(e)
  }
  const trainerList = Object.values(byTrainer).sort((a, b) => a.name.localeCompare(b.name))

  // Date nav
  function shiftDate(days) {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().slice(0, 10))
  }

  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-800">
        <span className="font-semibold">Experimental — Phase 1 (read-only).</span> Booking, cancelation, and attendance status are coming in later phases (some are blocked on ABC API discovery).
      </div>

      <div className="bg-surface border border-border rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {CLUB_NUMBERS.map(c => (
            <button key={c.slug} onClick={() => setClub(c)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                club.slug === c.slug ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'
              }`}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => shiftDate(-1)} className="px-2 py-1 rounded-lg bg-bg border border-border text-xs hover:bg-surface">‹</button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-2 py-1 bg-bg border border-border rounded-lg text-xs text-text-primary" />
          <button onClick={() => shiftDate(1)} className="px-2 py-1 rounded-lg bg-bg border border-border text-xs hover:bg-surface">›</button>
          <button onClick={() => setDate(todayLocalISO())} className="px-3 py-1 rounded-lg bg-bg border border-border text-xs hover:bg-surface">Today</button>
        </div>
      </div>

      {loading && <p className="text-sm text-text-muted py-4 text-center">Loading…</p>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}
      {!loading && !error && events.length === 0 && (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-sm text-text-muted">No PT appointments on this day.</div>
      )}

      {!loading && trainerList.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {trainerList.map(t => (
            <div key={t.name} className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-border bg-bg/50">
                <p className="text-sm font-bold text-text-primary">{t.name}</p>
                <p className="text-[10px] text-text-muted">{t.events.length} appointment{t.events.length === 1 ? '' : 's'}</p>
              </div>
              <div className="divide-y divide-border">
                {t.events
                  .slice()
                  .sort((a, b) => (a.event_timestamp_local || '').localeCompare(b.event_timestamp_local || ''))
                  .map(e => {
                    const b = statusBadge(e.status, e.attended_status)
                    const client = [e.member_first_name, e.member_last_name].filter(Boolean).join(' ') || '—'
                    return (
                      <button key={e.event_id} onClick={() => setSelectedEvent(e)}
                        className="w-full text-left px-4 py-2.5 hover:bg-bg/50 transition-colors flex items-center gap-3">
                        <div className="text-xs font-mono text-text-muted w-20 shrink-0">
                          {fmtTimeLocal(e.event_timestamp_local)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">{client}</p>
                          <p className="text-[11px] text-text-muted truncate">{e.event_name} · {e.duration_minutes || '?'} min</p>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${b.cls}`}>{b.label}</span>
                      </button>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedEvent && (
        <SessionBalanceModal event={selectedEvent} clubNumber={club.clubNumber} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  )
}
