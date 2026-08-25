import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { api } from '../../lib/api'
import {
  DAY_START_HOUR, DAY_END_HOUR, PX_PER_MINUTE, GRID_HEIGHT_PX, WEEKDAY_LABELS, MONTH_LABELS,
  startOfWeek, addDays, toISODate, fmtHour, fmtTime12, parseLocalTimestamp, layoutLanes,
} from '../../lib/weekGrid'


const CLUB_NUMBERS = [
  { slug: 'salem', name: 'Salem', clubNumber: '30935' },
  { slug: 'keizer', name: 'Keizer', clubNumber: '31599' },
  { slug: 'eugene', name: 'Eugene', clubNumber: '7655' },
  { slug: 'springfield', name: 'Springfield', clubNumber: '31598' },
  { slug: 'clackamas', name: 'Clackamas', clubNumber: '31600' },
  { slug: 'milwaukie', name: 'Milwaukie', clubNumber: '31601' },
  { slug: 'medford', name: 'Medford', clubNumber: '32073' },
]

// The four ABC event statuses this tool writes. These are the exact strings
// ABC's PUT .../events/{id}/status accepts — do not localise them.
const EVENT_STATUS_OPTIONS = [
  { value: 'Completed',          label: 'Completed',      cls: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' },
  { value: 'Pending',            label: 'Pending',        cls: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
  { value: 'Canceled-Charge',    label: 'Cancel (charge)', cls: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' },
  { value: 'Canceled-No Charge', label: 'Cancel (no charge)', cls: 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100' },
]

// Colour purely off the ABC event status. Attendance is deliberately ignored
// here — the scheduler tracks event status now, not per-member attendance.
function statusInfo(status) {
  const s = (status || '').toLowerCase()
  if (s.includes('no charge')) {
    return { label: 'Canceled (no charge)', badge: 'bg-gray-100 text-gray-700 border-gray-200', card: 'bg-gray-100 border-gray-300 text-gray-700' }
  }
  if (s.includes('cancel')) {
    return { label: 'Canceled (charge)', badge: 'bg-orange-50 text-orange-700 border-orange-200', card: 'bg-orange-50 border-orange-300 text-orange-900' }
  }
  if (s.includes('completed')) {
    return { label: 'Completed', badge: 'bg-green-50 text-green-700 border-green-200', card: 'bg-green-50 border-green-300 text-green-900' }
  }
  if (s.includes('pending') || s.includes('scheduled')) {
    return { label: 'Pending', badge: 'bg-blue-50 text-blue-700 border-blue-200', card: 'bg-blue-50 border-blue-300 text-blue-900' }
  }
  return { label: status || 'Unknown', badge: 'bg-gray-50 text-gray-700 border-gray-200', card: 'bg-gray-50 border-gray-300 text-gray-900' }
}

// Snap a pixel offset inside a day column to a 15-minute slot, clamped to the
// visible grid. PX_PER_MINUTE is 1, so pixels are minutes.
function yToTime(y) {
  const raw = y / PX_PER_MINUTE
  const snapped = Math.round(raw / 15) * 15
  const maxMin = (DAY_END_HOUR - DAY_START_HOUR) * 60 - 15
  const clamped = Math.max(0, Math.min(maxMin, snapped))
  const hour = DAY_START_HOUR + Math.floor(clamped / 60)
  const min = clamped % 60
  return { hour, min, hhmm: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}` }
}

// ---------------------------------------------------------------------------
// Event detail modal — shows the client's total remaining sessions and lets
// staff set the ABC event status.
// ---------------------------------------------------------------------------
function EventDetailModal({ event, clubNumber, onClose, onMutated }) {
  const [totals, setTotals] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionPending, setActionPending] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [actionSuccess, setActionSuccess] = useState(null)
  const [currentStatus, setCurrentStatus] = useState(event.status)

  async function setStatus(value) {
    if (!event.employee_id) {
      setActionError('This event has no trainer on file, so ABC will not accept a status change.')
      return
    }
    setActionPending('status:' + value); setActionError(null); setActionSuccess(null)
    try {
      await api(`/abc-scheduler/events/${encodeURIComponent(event.event_id)}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          club_number: clubNumber,
          status: value,
          employee_id: event.employee_id,
        }),
      })
      setCurrentStatus(value)
      setActionSuccess(`Status set to ${value}.`)
      if (onMutated) onMutated()
    } catch (e) {
      setActionError(e.message || 'Failed to set status')
    } finally {
      setActionPending(null)
    }
  }

  async function cancelEvent() {
    const ok = window.confirm(`Delete "${event.event_name || 'this event'}" from the ABC calendar? To keep it on the calendar but mark it cancelled, use the Cancel (charge / no charge) buttons instead.`)
    if (!ok) return
    setActionPending('cancel'); setActionError(null); setActionSuccess(null)
    try {
      await api(`/abc-scheduler/events/${encodeURIComponent(event.event_id)}?club_number=${encodeURIComponent(clubNumber)}`, {
        method: 'DELETE',
      })
      setActionSuccess('Event deleted.')
      if (onMutated) onMutated()
      setTimeout(onClose, 600)
    } catch (e) {
      setActionError(e.message || 'Failed to delete event')
    } finally {
      setActionPending(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const qs = new URLSearchParams({ club_number: clubNumber, member_id: event.member_id }).toString()
        const r = await api('/abc-scheduler/session-total?' + qs)
        if (!cancelled) setTotals(r)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load session total')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (event?.member_id) load()
    else { setLoading(false) }
    return () => { cancelled = true }
  }, [event, clubNumber])

  const clientName = [event.member_first_name, event.member_last_name].filter(Boolean).join(' ') || '—'
  const trainerName = [event.employee_first_name, event.employee_last_name].filter(Boolean).join(' ') || '—'
  const parsed = parseLocalTimestamp(event.event_timestamp_local)
  const timeStr = parsed ? fmtTime12(parsed.hour, parsed.min) : ''
  const badge = statusInfo(currentStatus)

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
          <div className="flex items-center justify-between bg-bg rounded-lg px-3 py-2">
            <span className="text-xs text-text-muted">Sessions remaining</span>
            <span className="text-sm font-semibold text-text-primary">
              {loading ? '…' : error ? '—' : (totals?.available ?? 0)}
            </span>
          </div>
          {error && <p className="text-[11px] text-red-600 px-1">{error}</p>}
        </div>

        <div className="border-t border-border pt-3 space-y-3">
          {(actionError || actionSuccess) && (
            <div className={`rounded-lg px-3 py-2 text-xs ${actionError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
              {actionError || actionSuccess}
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Event Status</p>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_STATUS_OPTIONS.map(opt => {
                const isCurrent = (currentStatus || '').toLowerCase() === opt.value.toLowerCase()
                const isPending = actionPending === 'status:' + opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setStatus(opt.value)}
                    disabled={!!actionPending || isCurrent}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${isCurrent ? 'bg-bg border-border text-text-muted' : opt.cls}`}
                    title={isCurrent ? 'Already set' : ''}
                  >
                    {isPending ? '…' : (isCurrent ? `✓ ${opt.label}` : opt.label)}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Manage Event</p>
            <button
              onClick={cancelEvent}
              disabled={!!actionPending}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
            >
              {actionPending === 'cancel' ? 'Deleting…' : 'Delete event'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Book Event modal — strict order: trainer, then client, then event type,
// then time. The client list is scoped to the chosen trainer's own roster
// (ABC serviceEmployeeId on the recurring service).
// ---------------------------------------------------------------------------
function BookEventModal({ club, defaultDate, defaultTime, defaultTrainerId, onClose, onCreated }) {
  const [trainers, setTrainers] = useState([])
  const [trainersLoading, setTrainersLoading] = useState(true)
  const [employeeId, setEmployeeId] = useState(defaultTrainerId && defaultTrainerId !== 'all' ? defaultTrainerId : '')

  const [clients, setClients] = useState([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientQuery, setClientQuery] = useState('')
  const [selectedMember, setSelectedMember] = useState(null)

  const [eventTypes, setEventTypes] = useState([])
  const [eventTypeId, setEventTypeId] = useState('')

  const [date, setDate] = useState(() => toISODate(defaultDate || new Date()))
  const [time, setTime] = useState(() => {
    if (defaultTime) return defaultTime
    const now = new Date()
    const hh = String(Math.max(DAY_START_HOUR, Math.min(DAY_END_HOUR - 1, now.getHours()))).padStart(2, '0')
    const mm = now.getMinutes() < 30 ? '00' : '30'
    return `${hh}:${mm}`
  })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Trainers (PT department only)
  useEffect(() => {
    let cancelled = false
    async function load() {
      setTrainersLoading(true)
      try {
        const r = await api(`/abc-scheduler/trainers?club_number=${encodeURIComponent(club.clubNumber)}`)
        if (!cancelled) setTrainers(r.trainers || [])
      } catch (_) {
        if (!cancelled) setTrainers([])
      } finally {
        if (!cancelled) setTrainersLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [club.clubNumber])

  // Event types
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const r = await api(`/abc-scheduler/event-types?club_number=${encodeURIComponent(club.clubNumber)}`)
        if (!cancelled) setEventTypes((r.event_types || []).filter(t => (t.category || 'Appointment') === 'Appointment'))
      } catch (_) {
        if (!cancelled) setEventTypes([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [club.clubNumber])

  // Clients for the chosen trainer. Reset the picked client when the trainer
  // changes so you can never submit a client who isn't on that roster.
  useEffect(() => {
    let cancelled = false
    setSelectedMember(null)
    setClientQuery('')
    if (!employeeId) { setClients([]); return }
    async function load() {
      setClientsLoading(true)
      try {
        const r = await api(`/abc-scheduler/trainers/${encodeURIComponent(employeeId)}/clients?club_number=${encodeURIComponent(club.clubNumber)}`)
        if (!cancelled) setClients(r.clients || [])
      } catch (_) {
        if (!cancelled) setClients([])
      } finally {
        if (!cancelled) setClientsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [employeeId, club.clubNumber])

  const filteredClients = useMemo(() => {
    const term = clientQuery.trim().toLowerCase()
    if (!term) return clients
    return clients.filter(c => (c.member_name || '').toLowerCase().includes(term))
  }, [clients, clientQuery])

  async function submit() {
    setSubmitError(null); setSuccess(null)
    if (!employeeId) { setSubmitError('Pick a trainer'); return }
    if (!selectedMember) { setSubmitError('Pick a client'); return }
    if (!eventTypeId) { setSubmitError('Pick an event type'); return }
    if (!date || !time) { setSubmitError('Pick a date and time'); return }

    // ABC POST /calendars/events body. startTime is "yyyy-MM-dd HH:mm:ss"
    // (space, not ISO 'T'). Duration is not accepted — ABC uses the event
    // type's configured default. levelId and allowUnfunded are filled in
    // server-side so this form never has to ask.
    const body = {
      club_number: club.clubNumber,
      eventTypeId,
      employeeId,
      memberId: selectedMember.member_id,
      startTime: `${date} ${time}:00`,
    }

    setSubmitting(true)
    try {
      const r = await api('/abc-scheduler/events', { method: 'POST', body: JSON.stringify(body) })
      const code = r?.status?.messageCode
      if (code && code !== 'API-CAL-EVT-0000') {
        setSubmitError(r?.status?.message || 'ABC rejected the booking')
        return
      }
      setSuccess('Event booked.')
      const newEventId = r?.result?.links?.[0]?.href?.split('/').filter(Boolean).pop()
      if (newEventId) {
        try {
          await api(`/abc-scheduler/events/${encodeURIComponent(newEventId)}/refresh-from-abc?club_number=${encodeURIComponent(club.clubNumber)}&near_date=${encodeURIComponent(date)}`, { method: 'POST' })
        } catch (_) { /* the next sync will pick it up */ }
      }
      if (onCreated) onCreated()
    } catch (e) {
      setSubmitError(e.message || 'Failed to book event')
    } finally {
      setSubmitting(false)
    }
  }

  const stepNum = (n, done) => (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mr-2 ${done ? 'bg-green-100 text-green-700' : 'bg-bg text-text-muted border border-border'}`}>{n}</span>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-t-0 border-b border-border flex items-center justify-between">
          <h3 className="text-lg font-bold text-text-primary">Book event</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* 1. Trainer */}
          <label className="block">
            <span className="block text-xs font-medium text-text-muted mb-1">{stepNum(1, !!employeeId)}Trainer</span>
            <select
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
            >
              <option value="">{trainersLoading ? 'Loading…' : '— select a trainer —'}</option>
              {trainers.map(t => (
                <option key={t.employee_id} value={t.employee_id}>{t.display_name}</option>
              ))}
            </select>
          </label>

          {/* 2. Client — only this trainer's roster */}
          <label className="block">
            <span className="block text-xs font-medium text-text-muted mb-1">{stepNum(2, !!selectedMember)}Client</span>
            {!employeeId ? (
              <p className="text-xs text-text-muted bg-bg border border-border rounded-lg px-3 py-2">Pick a trainer first.</p>
            ) : selectedMember ? (
              <div className="flex items-center justify-between bg-bg border border-border rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-text-primary">{selectedMember.member_name}</span>
                <button onClick={() => setSelectedMember(null)} className="text-xs text-text-muted hover:text-wcs-red">change</button>
              </div>
            ) : (
              <>
                <input
                  value={clientQuery}
                  onChange={e => setClientQuery(e.target.value)}
                  placeholder={clientsLoading ? 'Loading clients…' : `Search ${clients.length} assigned client${clients.length === 1 ? '' : 's'}…`}
                  className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
                />
                {!clientsLoading && clients.length === 0 && (
                  <span className="text-[10px] text-text-muted mt-1 block">
                    No clients are assigned to this trainer in ABC, and they have no sessions in the last 180 days.
                  </span>
                )}
                {filteredClients.length > 0 && (
                  <div className="mt-1 border border-border rounded-lg max-h-44 overflow-y-auto">
                    {filteredClients.map(c => (
                      <button
                        key={c.member_id}
                        onClick={() => { setSelectedMember(c); setClientQuery('') }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-bg border-b border-border last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text-primary">{c.member_name}</span>
                          {c.source === 'history' && (
                            <span
                              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-bg border border-border text-text-muted"
                              title="Not on this trainer's recurring-service roster — matched because they trained together in the last 180 days (covers paid-in-full clients)."
                            >
                              past client
                            </span>
                          )}
                        </div>
                        {c.services?.length > 0 && (
                          <div className="text-[10px] text-text-muted">{[...new Set(c.services)].join(', ')}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </label>

          {/* 3. Event type */}
          <label className="block">
            <span className="block text-xs font-medium text-text-muted mb-1">{stepNum(3, !!eventTypeId)}Event type</span>
            <select
              value={eventTypeId}
              onChange={e => setEventTypeId(e.target.value)}
              disabled={!selectedMember}
              className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red disabled:opacity-50"
            >
              <option value="">— select —</option>
              {eventTypes.map(t => (
                <option key={t.event_type_id} value={t.event_type_id}>{t.event_name}</option>
              ))}
            </select>
          </label>

          {/* 4. Date + time */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-xs font-medium text-text-muted mb-1">{stepNum(4, !!(date && time))}Date</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!eventTypeId}
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red disabled:opacity-50" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-text-muted mb-1">Time</span>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} step="900" disabled={!eventTypeId}
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red disabled:opacity-50" />
            </label>
          </div>

          {submitError && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{submitError}</div>}
          {success && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 text-sm">{success}</div>}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 bg-surface">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">
            {success ? 'Close' : 'Cancel'}
          </button>
          {!success && (
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-60"
            >
              {submitting ? 'Booking…' : 'Book event'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PtSchedulerView() {
  const [club, setClub] = useState(CLUB_NUMBERS[0])
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [events, setEvents] = useState([])
  const [sources, setSources] = useState(null)
  const [trainerOptions, setTrainerOptions] = useState([])
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [bookOpen, setBookOpen] = useState(false)
  const [bookDefaults, setBookDefaults] = useState({ date: null, time: null })
  const [reloadKey, setReloadKey] = useState(0)
  const [moveBanner, setMoveBanner] = useState(null)
  const scrollRef = useRef(null)
  const dragRef = useRef(null) // { event, grabOffsetMin }

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
        if (!cancelled) {
          setEvents(r.events || [])
          setSources(r.sources || null)
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load events')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [club, weekStart, reloadKey])

  const refetchEvents = useCallback(() => setReloadKey(k => k + 1), [])

  // Trainer filter list — PT-department staff only.
  useEffect(() => {
    let cancelled = false
    async function loadTrainers() {
      try {
        const r = await api(`/abc-scheduler/trainers?club_number=${encodeURIComponent(club.clubNumber)}`)
        if (!cancelled) setTrainerOptions(r.trainers || [])
      } catch (_) {
        if (!cancelled) setTrainerOptions([])
      }
    }
    loadTrainers()
    return () => { cancelled = true }
  }, [club])

  // Reset the trainer filter when switching clubs — an employeeId from the
  // previous club would silently match nothing.
  useEffect(() => { setTrainerFilter('all') }, [club])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 60
  }, [])

  const trainers = useMemo(
    () => trainerOptions
      .map(t => ({ id: t.employee_id, name: t.display_name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [trainerOptions],
  )

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
    for (const date of Object.keys(buckets)) {
      buckets[date] = layoutLanes(buckets[date])
    }
    return buckets
  }, [events, trainerFilter, weekStart])

  function openBooking(date, time) {
    setBookDefaults({ date: date || null, time: time || null })
    setBookOpen(true)
  }

  // Click an empty patch of a day column -> start a booking at that slot.
  function handleColumnClick(e, dayDate) {
    if (e.target.closest('[data-event-card]')) return
    const rect = e.currentTarget.getBoundingClientRect()
    const { hhmm } = yToTime(e.clientY - rect.top)
    openBooking(dayDate, hhmm)
  }

  // --- drag to move -------------------------------------------------------
  function handleDragStart(e, evt) {
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = { event: evt, grabOffsetMin: (e.clientY - rect.top) / PX_PER_MINUTE }
    e.dataTransfer.effectAllowed = 'move'
    // Firefox needs data set for a drag to start at all.
    try { e.dataTransfer.setData('text/plain', evt.event_id) } catch (_) { /* ignore */ }
  }

  async function handleDrop(e, dayDate) {
    e.preventDefault()
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    const evt = drag.event
    const rect = e.currentTarget.getBoundingClientRect()
    const { hhmm } = yToTime((e.clientY - rect.top) - drag.grabOffsetMin * PX_PER_MINUTE)
    const newDate = toISODate(dayDate)

    const parsed = parseLocalTimestamp(evt.event_timestamp_local)
    const oldTime = parsed ? `${String(parsed.hour).padStart(2, '0')}:${String(parsed.min).padStart(2, '0')}` : ''
    if (parsed && parsed.date === newDate && oldTime === hhmm) return

    if (!evt.event_type_id || !evt.employee_id || !evt.member_id) {
      setMoveBanner({ error: true, text: 'That event is missing a type, trainer, or client in our cache, so it cannot be re-booked.' })
      return
    }

    const client = [evt.member_first_name, evt.member_last_name].filter(Boolean).join(' ') || 'this client'
    const ok = window.confirm(
      `Move ${client}'s ${evt.event_name || 'session'} to ${newDate} at ${hhmm}?\n\n` +
      'ABC has no reschedule API, so this books a NEW event at the new time and then cancels the old one. ' +
      'The event ID will change.',
    )
    if (!ok) return

    setMoveBanner({ error: false, text: 'Moving…' })
    try {
      const r = await api(`/abc-scheduler/events/${encodeURIComponent(evt.event_id)}/move`, {
        method: 'POST',
        body: JSON.stringify({
          club_number: club.clubNumber,
          startTime: `${newDate} ${hhmm}:00`,
          eventTypeId: evt.event_type_id,
          employeeId: evt.employee_id,
          memberId: evt.member_id,
        }),
      })
      setMoveBanner(r.warning
        ? { error: true, text: r.warning }
        : { error: false, text: `Moved to ${newDate} at ${hhmm}.` })
      refetchEvents()
    } catch (err) {
      setMoveBanner({ error: true, text: err.message || 'Move failed — the original event was left alone.' })
    }
  }

  const now = new Date()
  const todayISO = toISODate(now)
  const nowMin = (now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes()
  const nowInGrid = nowMin >= 0 && nowMin <= (DAY_END_HOUR - DAY_START_HOUR) * 60

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
        <span className="font-semibold">Writes go straight to ABC.</span> Booking, status changes, moves, and deletions all affect production club data.
      </div>

      {/* Toolbar */}
      <div className="bg-surface border border-border rounded-xl p-3 flex flex-wrap items-center gap-3">
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
          <button
            onClick={() => openBooking(null, null)}
            className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red-hover"
          >
            + Book event
          </button>
          <select value={club.slug} onChange={e => {
            const c = CLUB_NUMBERS.find(x => x.slug === e.target.value)
            if (c) setClub(c)
          }} className="px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-primary">
            {CLUB_NUMBERS.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <select value={trainerFilter} onChange={e => setTrainerFilter(e.target.value)}
            className="px-3 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-primary min-w-[160px]">
            <option value="all">All Trainers ({trainers.length})</option>
            {trainers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}
      {moveBanner && (
        <div className={`rounded-xl px-4 py-2 text-xs flex items-center justify-between ${moveBanner.error ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
          <span>{moveBanner.text}</span>
          <button onClick={() => setMoveBanner(null)} className="opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Calendar grid */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
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

        <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
          <div className="grid relative" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', height: `${GRID_HEIGHT_PX}px` }}>
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

            {Array.from({ length: 7 }, (_, dayIdx) => {
              const dayDate = addDays(weekStart, dayIdx)
              const dayISO = toISODate(dayDate)
              const dayEvents = eventsByDay[dayISO] || []
              const isToday = dayISO === todayISO
              return (
                <div
                  key={dayIdx}
                  className={`relative border-r last:border-r-0 border-border cursor-copy ${isToday ? 'bg-wcs-red/[0.02]' : ''}`}
                  onClick={e => handleColumnClick(e, dayDate)}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                  onDrop={e => handleDrop(e, dayDate)}
                  title="Click an empty slot to book"
                >
                  {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => (
                    <div key={i} className="absolute left-0 right-0 border-b border-border/40 pointer-events-none" style={{ top: `${i * 60}px`, height: '60px' }}>
                      <div className="absolute left-0 right-0 border-b border-dashed border-border/20" style={{ top: '30px' }} />
                    </div>
                  ))}

                  {isToday && nowInGrid && (
                    <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: `${nowMin}px` }}>
                      <div className="h-0.5 bg-wcs-red" />
                      <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-wcs-red" />
                    </div>
                  )}

                  {dayEvents.map(e => {
                    const top = e._startMin * PX_PER_MINUTE
                    const height = Math.max(20, (e._endMin - e._startMin) * PX_PER_MINUTE)
                    const widthPct = 100 / (e._laneCount || 1)
                    const leftPct = (e._laneIndex || 0) * widthPct
                    const info = statusInfo(e.status)
                    const client = [e.member_first_name, e.member_last_name].filter(Boolean).join(' ') || '—'
                    return (
                      <div
                        key={e.event_id}
                        data-event-card
                        draggable
                        onDragStart={ev => handleDragStart(ev, e)}
                        onClick={ev => { ev.stopPropagation(); setSelectedEvent(e) }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={ev => { if (ev.key === 'Enter') { ev.stopPropagation(); setSelectedEvent(e) } }}
                        className={`absolute z-10 rounded-md border-l-2 text-left px-1.5 py-1 overflow-hidden text-[10px] leading-tight cursor-grab active:cursor-grabbing hover:shadow-md hover:z-30 transition-shadow ${info.card}`}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                        }}
                        title={`${client} · ${e.event_name} · ${e._trainerName} — drag to move`}
                      >
                        <div className="font-semibold truncate">{client}</div>
                        {height >= 28 && <div className="opacity-70 truncate">{e.event_name}</div>}
                        {height >= 44 && trainerFilter === 'all' && <div className="opacity-60 truncate">{e._trainerName}</div>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="text-[11px] text-text-muted px-1 flex items-center gap-3 flex-wrap">
        <span>{loading ? 'Loading…' : `${events.length} event${events.length === 1 ? '' : 's'} this week`}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-300" /> Pending</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-300" /> Completed</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-300" /> Canceled (charge)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gray-300" /> Canceled (no charge)</span>
        <span className="ml-auto">Click an empty slot to book · drag an event to move it</span>
      </div>

      {sources && (
        <details className="text-[11px] text-text-muted px-1">
          <summary className="cursor-pointer select-none">
            Data sources — cached: <b>{sources.cached ?? 0}</b> · live (deduped): <b>{sources.liveTotal ?? 0}</b>
            {sources.abcDateRange && <> · ABC range <code className="text-[10px]">{sources.abcDateRange}</code></>}
          </summary>
          <div className="mt-1 ml-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1 font-mono">
            {Object.entries(sources.live || {}).map(([key, info]) => {
              const ok = info.http >= 200 && info.http < 300
              return (
                <div key={key} className={`px-2 py-0.5 rounded ${ok ? 'bg-bg' : 'bg-red-50 text-red-700'}`}>
                  <span className="font-semibold">{key}</span>: {info.kept}/{info.raw} (http {info.http})
                  {info.error && <span className="text-red-600"> · {info.error}</span>}
                </div>
              )
            })}
          </div>
        </details>
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          clubNumber={club.clubNumber}
          onClose={() => setSelectedEvent(null)}
          onMutated={refetchEvents}
        />
      )}

      {bookOpen && (
        <BookEventModal
          club={club}
          defaultDate={bookDefaults.date || weekStart}
          defaultTime={bookDefaults.time}
          defaultTrainerId={trainerFilter}
          onClose={() => setBookOpen(false)}
          onCreated={refetchEvents}
        />
      )}
    </div>
  )
}
