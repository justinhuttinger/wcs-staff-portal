import { useState, useEffect, useMemo, useRef } from 'react'
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

// Calendar grid config
const DAY_START_HOUR = 6           // 6 AM
const DAY_END_HOUR = 22            // 10 PM
const PX_PER_MINUTE = 1            // 1px = 1 minute → 30min slot = 30px
const GRID_HEIGHT_PX = (DAY_END_HOUR - DAY_START_HOUR) * 60 * PX_PER_MINUTE
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Sunday of the week containing `d` (local time)
function startOfWeek(d) {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() - out.getDay())
  return out
}

function addDays(d, n) {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function fmtHour(h) {
  const ampm = h >= 12 ? 'PM' : 'AM'
  let hh = h % 12 || 12
  return `${hh} ${ampm}`
}

function fmtTime12(hour, min) {
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hh = hour % 12 || 12
  const mm = String(min).padStart(2, '0')
  return `${hh}:${mm} ${ampm}`
}

// "YYYY-MM-DDTHH:mm:ss" → { date: 'YYYY-MM-DD', hour, min }
function parseLocalTimestamp(ts) {
  if (!ts) return null
  const m = String(ts).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  return { date: m[1], hour: parseInt(m[2], 10), min: parseInt(m[3], 10) }
}

// Same heuristic as before, paired with a color hint for the event card
function statusInfo(status, attended) {
  const s = (attended || status || '').toLowerCase()
  if (s.includes('did not attend') || s.includes('no show') || s.includes('no-show')) {
    return { label: 'No Show', badge: 'bg-red-50 text-red-700 border-red-200', card: 'bg-red-50 border-red-300 text-red-900' }
  }
  if (s.includes('cancel')) {
    return { label: status || 'Canceled', badge: 'bg-orange-50 text-orange-700 border-orange-200', card: 'bg-orange-50 border-orange-300 text-orange-900 line-through-decoration' }
  }
  if (s.includes('completed') || s.includes('attended')) {
    return { label: 'Completed', badge: 'bg-green-50 text-green-700 border-green-200', card: 'bg-green-50 border-green-300 text-green-900' }
  }
  if (s.includes('pending') || s.includes('scheduled')) {
    return { label: 'Scheduled', badge: 'bg-blue-50 text-blue-700 border-blue-200', card: 'bg-blue-50 border-blue-300 text-blue-900' }
  }
  return { label: status || 'Unknown', badge: 'bg-gray-50 text-gray-700 border-gray-200', card: 'bg-gray-50 border-gray-300 text-gray-900' }
}

function SessionBalanceModal({ event, clubNumber, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const qs = new URLSearchParams({
          club_number: clubNumber, member_id: event.member_id, event_type_id: event.event_type_id || '',
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
  const parsed = parseLocalTimestamp(event.event_timestamp_local)
  const timeStr = parsed ? fmtTime12(parsed.hour, parsed.min) : ''
  const badge = statusInfo(event.status, event.attended_status)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{event.event_name || 'Appointment'}</h3>
            <p className="text-xs text-text-muted mt-0.5">{timeStr} · {event.duration_minutes || '?'} min · {trainerName}</p>
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
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badge.badge}`}>{badge.label}</span>
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

        <p className="text-[10px] text-text-muted mt-3 italic">Phase 1: viewer only. Booking + attendance changes pending ABC API write access.</p>
      </div>
    </div>
  )
}

// Place overlapping events side-by-side within a day column.
// Returns each event with { laneIndex, laneCount } so the render layer can size.
function layoutLanes(events) {
  const sorted = events.slice().sort((a, b) => a._startMin - b._startMin)
  const lanes = [] // each lane is a list of events; lanes[i] holds the latest endMin

  for (const e of sorted) {
    let placed = false
    for (let i = 0; i < lanes.length; i++) {
      const last = lanes[i][lanes[i].length - 1]
      if (last._endMin <= e._startMin) {
        e._laneIndex = i
        lanes[i].push(e)
        placed = true
        break
      }
    }
    if (!placed) {
      e._laneIndex = lanes.length
      lanes.push([e])
    }
  }
  // Now compute laneCount per event — for overlap-group correctness, set
  // laneCount = max lanes occupied by any event in its overlap cluster.
  // Simple version: every event uses total lanes (slight horizontal waste
  // but no overlap mistakes).
  const totalLanes = Math.max(1, lanes.length)
  for (const e of sorted) e._laneCount = totalLanes
  return sorted
}

export default function PtSchedulerView() {
  const [club, setClub] = useState(CLUB_NUMBERS[0])
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [events, setEvents] = useState([])
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const scrollRef = useRef(null)

  // Fetch week's events whenever club or week changes
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const start = toISODate(weekStart)
        const end = toISODate(addDays(weekStart, 6))
        const qs = new URLSearchParams({
          club_number: club.clubNumber, start, end, category: 'Appointment',
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
  }, [club, weekStart])

  // Auto-scroll the grid so 7 AM is visible on first render
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 60
  }, [])

  // Trainer list, derived from the week's events. Sorted alphabetically by last name.
  const trainers = useMemo(() => {
    const byId = new Map()
    for (const e of events) {
      if (!e.employee_id) continue
      if (!byId.has(e.employee_id)) {
        byId.set(e.employee_id, {
          id: e.employee_id,
          name: [e.employee_first_name, e.employee_last_name].filter(Boolean).join(' ') || 'Unknown',
        })
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [events])

  // Day-grouped, decorated events for rendering. Filtered by trainer.
  const eventsByDay = useMemo(() => {
    const buckets = {}
    for (let i = 0; i < 7; i++) buckets[toISODate(addDays(weekStart, i))] = []
    for (const e of events) {
      if (trainerFilter !== 'all' && e.employee_id !== trainerFilter) continue
      const p = parseLocalTimestamp(e.event_timestamp_local)
      if (!p) continue
      if (!(p.date in buckets)) continue
      const startMin = (p.hour - DAY_START_HOUR) * 60 + p.min
      const duration = e.duration_minutes || 30
      buckets[p.date].push({
        ...e,
        _date: p.date,
        _startMin: startMin,
        _endMin: startMin + duration,
        _trainerName: [e.employee_first_name, e.employee_last_name].filter(Boolean).join(' '),
      })
    }
    // Lane layout per day
    for (const date of Object.keys(buckets)) {
      buckets[date] = layoutLanes(buckets[date])
    }
    return buckets
  }, [events, trainerFilter, weekStart])

  // Now-line: only show if today is in the visible week
  const now = new Date()
  const todayISO = toISODate(now)
  const nowMin = (now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes()
  const nowInGrid = nowMin >= 0 && nowMin <= (DAY_END_HOUR - DAY_START_HOUR) * 60

  // Header label e.g. "May 11 – May 17, 2026"
  const weekEnd = addDays(weekStart, 6)
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth()
  const sameYear = weekStart.getFullYear() === weekEnd.getFullYear()
  const headerLabel = sameMonth
    ? `${MONTH_LABELS[weekStart.getMonth()]} ${weekStart.getDate()} – ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
    : sameYear
    ? `${MONTH_LABELS[weekStart.getMonth()]} ${weekStart.getDate()} – ${MONTH_LABELS[weekEnd.getMonth()]} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
    : `${MONTH_LABELS[weekStart.getMonth()]} ${weekStart.getDate()}, ${weekStart.getFullYear()} – ${MONTH_LABELS[weekEnd.getMonth()]} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`

  return (
    <div className="space-y-3">
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2 text-xs text-yellow-800">
        <span className="font-semibold">Experimental — read-only.</span> Booking, cancelation, and attendance changes pending ABC API write access.
      </div>

      {/* Toolbar */}
      <div className="bg-surface border border-border rounded-xl p-3 flex flex-wrap items-center gap-3">
        {/* Week nav */}
        <div className="flex items-center gap-1">
          <button onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="px-3 py-1.5 rounded-lg bg-bg border border-border text-xs font-medium text-text-primary hover:bg-surface">
            Today
          </button>
          <button onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="px-2 py-1.5 rounded-lg bg-bg border border-border text-text-muted hover:text-text-primary" aria-label="Previous week">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="px-2 py-1.5 rounded-lg bg-bg border border-border text-text-muted hover:text-text-primary" aria-label="Next week">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M9 5l7 7-7 7" /></svg>
          </button>
          <span className="ml-2 text-sm font-semibold text-text-primary">{headerLabel}</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Location */}
          <select value={club.slug} onChange={e => {
            const c = CLUB_NUMBERS.find(x => x.slug === e.target.value)
            if (c) setClub(c)
          }} className="px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-primary">
            {CLUB_NUMBERS.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          {/* Trainer */}
          <select value={trainerFilter} onChange={e => setTrainerFilter(e.target.value)}
            className="px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-primary min-w-[160px]">
            <option value="all">All Trainers ({trainers.length})</option>
            {trainers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      {/* Calendar grid */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {/* Day-of-week header (sticky) */}
        <div className="grid border-b border-border" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
          <div className="border-r border-border" />
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDays(weekStart, i)
            const isToday = toISODate(d) === todayISO
            return (
              <div key={i} className={`text-center py-2 border-r last:border-r-0 border-border ${isToday ? 'bg-wcs-red/5' : ''}`}>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">{WEEKDAY_LABELS[d.getDay()]}</div>
                <div className={`text-base font-semibold ${isToday ? 'text-wcs-red' : 'text-text-primary'}`}>{d.getDate()}</div>
              </div>
            )
          })}
        </div>

        {/* Scrollable time grid */}
        <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
          <div className="grid relative" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', height: `${GRID_HEIGHT_PX}px` }}>
            {/* Hour labels column */}
            <div className="border-r border-border relative">
              {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => {
                const h = DAY_START_HOUR + i
                return (
                  <div key={h} className="absolute right-1 text-[10px] text-text-muted"
                    style={{ top: `${i * 60 - 6}px` }}>
                    {fmtHour(h)}
                  </div>
                )
              })}
            </div>

            {/* Day columns */}
            {Array.from({ length: 7 }, (_, dayIdx) => {
              const dayDate = addDays(weekStart, dayIdx)
              const dayISO = toISODate(dayDate)
              const dayEvents = eventsByDay[dayISO] || []
              const isToday = dayISO === todayISO
              return (
                <div key={dayIdx} className={`relative border-r last:border-r-0 border-border ${isToday ? 'bg-wcs-red/[0.02]' : ''}`}>
                  {/* Hour gridlines */}
                  {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => (
                    <div key={i} className="absolute left-0 right-0 border-b border-border/40" style={{ top: `${i * 60}px`, height: '60px' }}>
                      {/* Half-hour line */}
                      <div className="absolute left-0 right-0 border-b border-dashed border-border/20" style={{ top: '30px' }} />
                    </div>
                  ))}

                  {/* Now-line */}
                  {isToday && nowInGrid && (
                    <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: `${nowMin}px` }}>
                      <div className="h-0.5 bg-wcs-red" />
                      <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-wcs-red" />
                    </div>
                  )}

                  {/* Events */}
                  {dayEvents.map(e => {
                    const top = e._startMin * PX_PER_MINUTE
                    const height = Math.max(20, (e._endMin - e._startMin) * PX_PER_MINUTE)
                    const widthPct = 100 / (e._laneCount || 1)
                    const leftPct = (e._laneIndex || 0) * widthPct
                    const info = statusInfo(e.status, e.attended_status)
                    const client = [e.member_first_name, e.member_last_name].filter(Boolean).join(' ') || '—'
                    return (
                      <button
                        key={e.event_id}
                        onClick={() => setSelectedEvent(e)}
                        className={`absolute z-10 rounded-md border-l-2 text-left px-1.5 py-1 overflow-hidden text-[10px] leading-tight hover:shadow-md hover:z-30 transition-shadow ${info.card}`}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                        }}
                        title={`${client} · ${e.event_name} · ${e._trainerName}`}
                      >
                        <div className="font-semibold truncate">{client}</div>
                        {height >= 28 && <div className="opacity-70 truncate">{e.event_name}</div>}
                        {height >= 44 && trainerFilter === 'all' && <div className="opacity-60 truncate">{e._trainerName}</div>}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Footer summary */}
      <div className="text-[11px] text-text-muted px-1 flex items-center gap-3 flex-wrap">
        <span>{loading ? 'Loading…' : `${events.length} event${events.length === 1 ? '' : 's'} this week`}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-300" /> Scheduled</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-300" /> Completed</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-300" /> No Show</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-300" /> Canceled</span>
      </div>

      {selectedEvent && (
        <SessionBalanceModal event={selectedEvent} clubNumber={club.clubNumber} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  )
}
