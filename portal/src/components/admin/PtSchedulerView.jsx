import { useState, useEffect, useMemo, useRef } from 'react'
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

const ATTENDANCE_OPTIONS = [
  { value: 'Attended',       label: 'Attended',     cls: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' },
  { value: 'Did Not Attend', label: 'No-show',      cls: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' },
  { value: 'Pending',        label: 'Pending',      cls: 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100' },
]

function SessionBalanceModal({ event, clubNumber, onClose, onMutated }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionPending, setActionPending] = useState(null) // string label or null
  const [actionError, setActionError] = useState(null)
  const [actionSuccess, setActionSuccess] = useState(null)
  const [currentAttended, setCurrentAttended] = useState(event.attended_status)

  async function markAttendance(value) {
    if (!event.member_id) return
    setActionPending('attendance:' + value); setActionError(null); setActionSuccess(null)
    try {
      await api(`/abc-scheduler/events/${encodeURIComponent(event.event_id)}/attendance`, {
        method: 'PUT',
        body: JSON.stringify({
          club_number: clubNumber, member_id: event.member_id, attended_status: value,
        }),
      })
      setCurrentAttended(value)
      setActionSuccess(`Marked as ${value}.`)
      if (onMutated) onMutated()
    } catch (e) {
      setActionError(e.message || 'Failed to update attendance')
    } finally {
      setActionPending(null)
    }
  }

  async function cancelEvent() {
    const ok = window.confirm(`Cancel "${event.event_name || 'this event'}"? This removes it from ABC for all members.`)
    if (!ok) return
    setActionPending('cancel'); setActionError(null); setActionSuccess(null)
    try {
      await api(`/abc-scheduler/events/${encodeURIComponent(event.event_id)}?club_number=${encodeURIComponent(clubNumber)}`, {
        method: 'DELETE',
      })
      setActionSuccess('Event canceled.')
      if (onMutated) onMutated()
      setTimeout(onClose, 600)
    } catch (e) {
      setActionError(e.message || 'Failed to cancel event')
    } finally {
      setActionPending(null)
    }
  }

  async function removeMember() {
    if (!event.member_id) return
    const name = [event.member_first_name, event.member_last_name].filter(Boolean).join(' ') || 'this member'
    const ok = window.confirm(`Remove ${name} from this event? The event will remain for any other members.`)
    if (!ok) return
    setActionPending('remove'); setActionError(null); setActionSuccess(null)
    try {
      await api(`/abc-scheduler/events/${encodeURIComponent(event.event_id)}/members/${encodeURIComponent(event.member_id)}?club_number=${encodeURIComponent(clubNumber)}`, {
        method: 'DELETE',
      })
      setActionSuccess('Member removed from event.')
      if (onMutated) onMutated()
      setTimeout(onClose, 600)
    } catch (e) {
      setActionError(e.message || 'Failed to remove member')
    } finally {
      setActionPending(null)
    }
  }

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

        {/* Attendance + cancel actions */}
        <div className="border-t border-border pt-3 mt-3 space-y-3">
          {(actionError || actionSuccess) && (
            <div className={`rounded-lg px-3 py-2 text-xs ${actionError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
              {actionError || actionSuccess}
            </div>
          )}

          {event.member_id && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Attendance</p>
              <div className="flex flex-wrap gap-1.5">
                {ATTENDANCE_OPTIONS.map(opt => {
                  const isCurrent = currentAttended === opt.value
                  const isPending = actionPending === 'attendance:' + opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => markAttendance(opt.value)}
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
          )}

          <div>
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Manage Event</p>
            <div className="flex flex-wrap gap-1.5">
              {event.member_id && (
                <button
                  onClick={removeMember}
                  disabled={!!actionPending}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-text-muted hover:text-text-primary hover:bg-bg disabled:opacity-50"
                >
                  {actionPending === 'remove' ? '…' : 'Remove this member'}
                </button>
              )}
              <button
                onClick={cancelEvent}
                disabled={!!actionPending}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
              >
                {actionPending === 'cancel' ? 'Canceling…' : 'Cancel event'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Book Event modal — POSTs a new event to /abc-scheduler/events. The ABC
// payload shape is a best guess based on the GET response (eventTypeId +
// eventTimestamp + duration + employeeId + members[]); backend passes the
// body through unchanged so this is iterable without redeploys.
// ---------------------------------------------------------------------------
function BookEventModal({ club, defaultDate, onClose, onCreated }) {
  const [eventTypes, setEventTypes] = useState([])
  const [employees, setEmployees] = useState([])
  const [memberQuery, setMemberQuery] = useState('')
  const [memberResults, setMemberResults] = useState([])
  const [selectedMember, setSelectedMember] = useState(null)
  const [memberSearchPending, setMemberSearchPending] = useState(false)

  const [eventTypeId, setEventTypeId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState(() => toISODate(defaultDate || new Date()))
  const [time, setTime] = useState(() => {
    const now = new Date()
    const hh = String(Math.max(DAY_START_HOUR, Math.min(DAY_END_HOUR - 1, now.getHours()))).padStart(2, '0')
    const mm = now.getMinutes() < 30 ? '00' : '30'
    return `${hh}:${mm}`
  })
  const [duration, setDuration] = useState(60)
  const [allowUnfunded, setAllowUnfunded] = useState(false)
  const [trainingLevels, setTrainingLevels] = useState([])
  const [trainingLevelId, setTrainingLevelId] = useState('')
  const [trainingLevelManual, setTrainingLevelManual] = useState('')
  const [trainingLevelsLoading, setTrainingLevelsLoading] = useState(false)
  const [rawSample, setRawSample] = useState(null)
  const [rawSampleLoading, setRawSampleLoading] = useState(false)
  const [rawSampleError, setRawSampleError] = useState(null)
  const [abcDetail, setAbcDetail] = useState(null)
  const [abcDetailLoading, setAbcDetailLoading] = useState(false)

  // Look at the cache first; if no useful levelId surfaces, hit ABC directly.
  async function loadLevelDiscovery() {
    if (!eventTypeId) return
    setRawSampleLoading(true); setRawSampleError(null); setRawSample(null); setAbcDetail(null)
    try {
      const r = await api(`/abc-scheduler/event-types/${encodeURIComponent(eventTypeId)}/raw-sample?club_number=${encodeURIComponent(club.clubNumber)}`)
      setRawSample(r.sample || null)
      const cachedLevelId = r.sample?.raw?.eventTrainingLevel?.levelId
        || r.sample?.raw?.eventTrainingLevel?.id
      if (!cachedLevelId) {
        // Cache had nothing useful — ask ABC directly.
        setAbcDetailLoading(true)
        try {
          const abc = await api(`/abc-scheduler/event-types/${encodeURIComponent(eventTypeId)}/abc-detail?club_number=${encodeURIComponent(club.clubNumber)}`)
          setAbcDetail(abc)
        } catch (e2) {
          setAbcDetail({ error: e2.message || 'ABC discovery failed' })
        } finally {
          setAbcDetailLoading(false)
        }
      }
    } catch (e) {
      setRawSampleError(e.message || 'Failed to fetch sample')
    } finally {
      setRawSampleLoading(false)
    }
  }

  // Extract a likely levelId + levelName from either source.
  const cachedLevelId = rawSample?.raw?.eventTrainingLevel?.levelId
    || rawSample?.raw?.eventTrainingLevel?.id
    || null
  const cachedLevelName = rawSample?.raw?.eventTrainingLevel?.levelName
    || rawSample?.raw?.eventTrainingLevel?.name
    || null

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [debugResponse, setDebugResponse] = useState(null)

  // Load event types + employees on open
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const [et, emp] = await Promise.all([
          api(`/abc-scheduler/event-types?club_number=${encodeURIComponent(club.clubNumber)}`),
          api(`/abc-scheduler/employees?club_number=${encodeURIComponent(club.clubNumber)}`),
        ])
        if (cancelled) return
        setEventTypes(et.event_types || [])
        setEmployees(emp.employees || [])
        if ((et.event_types || []).length > 0) {
          setEventTypeId(et.event_types[0].event_type_id)
          if (et.event_types[0].default_duration_minutes) {
            setDuration(et.event_types[0].default_duration_minutes)
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load picker data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [club.clubNumber])

  // Member search — debounced
  useEffect(() => {
    if (!memberQuery || memberQuery.trim().length < 2) {
      setMemberResults([])
      return
    }
    const q = memberQuery.trim()
    setMemberSearchPending(true)
    const t = setTimeout(async () => {
      try {
        const r = await api(`/abc-scheduler/members/search?club_number=${encodeURIComponent(club.clubNumber)}&q=${encodeURIComponent(q)}`)
        setMemberResults(r.members || [])
      } catch (_) {
        setMemberResults([])
      } finally {
        setMemberSearchPending(false)
      }
    }, 280)
    return () => clearTimeout(t)
  }, [memberQuery, club.clubNumber])

  // Training levels — refetch when event type changes
  useEffect(() => {
    if (!eventTypeId) {
      setTrainingLevels([])
      setTrainingLevelId('')
      return
    }
    let cancelled = false
    async function load() {
      setTrainingLevelsLoading(true)
      try {
        const r = await api(`/abc-scheduler/training-levels?club_number=${encodeURIComponent(club.clubNumber)}&event_type_id=${encodeURIComponent(eventTypeId)}`)
        if (cancelled) return
        const levels = r.training_levels || []
        setTrainingLevels(levels)
        // Default to most-observed (already sorted) so the common case is one click.
        setTrainingLevelId(levels[0]?.level_id || '')
      } catch (_) {
        if (!cancelled) { setTrainingLevels([]); setTrainingLevelId('') }
      } finally {
        if (!cancelled) setTrainingLevelsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [eventTypeId, club.clubNumber])

  const selectedType = eventTypes.find(t => t.event_type_id === eventTypeId)

  async function submit() {
    setSubmitError(null); setSuccess(null); setDebugResponse(null)
    if (!eventTypeId) { setSubmitError('Pick an event type'); return }
    if (!employeeId) { setSubmitError('Pick a trainer'); return }
    if (!selectedMember) { setSubmitError('Pick a member'); return }
    if (!date || !time) { setSubmitError('Pick a date and time'); return }

    // ABC POST /calendars/events body shape — locked in 2026-05-12 by
    // iterative discovery (see git log of this file for the trail).
    // Confirmed required + accepted fields (echoed by ABC on success):
    //   eventTypeId, employeeId, memberId, levelId, startTime, allowUnfunded
    // Notes:
    //   - startTime format: "yyyy-MM-dd HH:mm:ss" (space, NOT ISO 'T')
    //   - Field names DIFFER from what GET returns:
    //       GET response                →  POST request
    //       eventTimestamp                 startTime
    //       eventTrainingLevel.levelId  →  levelId (flat top-level)
    //   - Duration is NOT accepted — ABC uses the event type's configured
    //     default duration. None of our duration field variants ever
    //     appeared in ABC's echo, yet bookings still succeed.
    //   - The portal modal's Duration picker is UI-only; not sent.
    const finalLevelId = (trainingLevelManual && trainingLevelManual.trim()) || trainingLevelId
    const body = {
      club_number: club.clubNumber, // stripped by backend before forwarding
      eventTypeId,
      employeeId,
      memberId: selectedMember.member_id,
      startTime: `${date} ${time}:00`,
      allowUnfunded,
    }
    if (finalLevelId) body.levelId = finalLevelId

    setSubmitting(true)
    try {
      const r = await api('/abc-scheduler/events', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setSuccess('Event created.')

      // Extract new eventId from the success response and pull it into our
      // local cache so the calendar view shows it without waiting for the
      // next ghl-sync run. Surface whatever happened in the debug response
      // so we can see why an event might not appear on the calendar.
      const newEventId = r?.result?.links?.[0]?.href?.split('/').filter(Boolean).pop()
      let refresh = null
      if (newEventId) {
        try {
          refresh = await api(`/abc-scheduler/events/${encodeURIComponent(newEventId)}/refresh-from-abc?club_number=${encodeURIComponent(club.clubNumber)}&near_date=${encodeURIComponent(date)}`, {
            method: 'POST',
          })
        } catch (err) {
          refresh = { error: err.message || 'refresh-from-abc threw' }
        }
      } else {
        refresh = { error: 'No eventId extracted from POST response' }
      }
      setDebugResponse({ sent: body, received: r, refresh })
      if (onCreated) onCreated()
    } catch (e) {
      setSubmitError(e.message || 'Failed to create event')
      // Show what we shipped so the user can compare against ABC's echo.
      setDebugResponse({ sent: body, error: e.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">Book event</h3>
            <p className="text-xs text-text-muted">{club.name} (club #{club.clubNumber})</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading && <div className="text-sm text-text-muted text-center py-6">Loading…</div>}
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

          {!loading && !error && (
            <>
              {/* Event type */}
              <label className="block">
                <span className="block text-xs font-medium text-text-muted mb-1">Event type</span>
                <select
                  value={eventTypeId}
                  onChange={e => {
                    setEventTypeId(e.target.value)
                    const t = eventTypes.find(t => t.event_type_id === e.target.value)
                    if (t?.default_duration_minutes) setDuration(t.default_duration_minutes)
                  }}
                  className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
                >
                  <option value="">— select —</option>
                  {eventTypes.map(t => (
                    <option key={t.event_type_id} value={t.event_type_id}>
                      {t.event_name} {t.category === 'Class' ? '(Class)' : ''} · {t.observed_count}× last 180d
                    </option>
                  ))}
                </select>
                {selectedType && (
                  <span className="block text-[10px] text-text-muted mt-1">
                    Category: {selectedType.category} · Default duration: {selectedType.default_duration_minutes || '—'} min
                  </span>
                )}
              </label>

              {/* Training level — always shown. Dropdown is populated from our
                  cache of seen levels for this event type; manual override
                  text input lets staff paste an ID when the cache is empty
                  (new event type, or ABC never returned levelId in GET).   */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="block text-xs font-medium text-text-muted">Training level</span>
                  <button
                    type="button"
                    onClick={loadLevelDiscovery}
                    disabled={!eventTypeId || rawSampleLoading || abcDetailLoading}
                    className="text-[10px] text-wcs-red hover:underline disabled:opacity-50"
                    title="Cache + live ABC lookup to discover valid training levels"
                  >
                    {rawSampleLoading ? 'Searching cache…' : abcDetailLoading ? 'Querying ABC…' : 'Discover real levelId'}
                  </button>
                </div>
                {trainingLevelsLoading ? (
                  <div className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-muted">Loading…</div>
                ) : trainingLevels.length > 0 ? (
                  <select
                    value={trainingLevelId}
                    onChange={e => setTrainingLevelId(e.target.value)}
                    className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
                  >
                    {trainingLevels.map(l => (
                      <option key={l.level_id} value={l.level_id}>
                        {l.level_name} · {l.observed_count}× last seen
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1">
                    No training levels cached for this event type. Paste one below if ABC requires it.
                  </div>
                )}
                <input
                  type="text"
                  value={trainingLevelManual}
                  onChange={e => setTrainingLevelManual(e.target.value)}
                  placeholder={trainingLevels.length > 0 ? 'Manual levelId override (optional)' : 'levelId (e.g. xzxxx…001)'}
                  className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-xs font-mono focus:outline-none focus:border-wcs-red"
                />
                <p className="text-[10px] text-text-muted">
                  Manual override wins if filled. ABC's POST expects a top-level <code>levelId</code> (confirmed 2026-05-12).
                </p>
                {rawSampleError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-2 py-1 text-[11px]">
                    {rawSampleError}
                  </div>
                )}
                {cachedLevelId && (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-green-900">
                      Found a real levelId in cached events:{' '}
                      <code className="font-mono">{cachedLevelId}</code>
                      {cachedLevelName && <span className="text-green-800"> ({cachedLevelName})</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTrainingLevelManual(cachedLevelId)}
                      className="px-2 py-1 rounded bg-wcs-red text-white text-[10px] font-semibold shrink-0"
                    >
                      Use this ID
                    </button>
                  </div>
                )}
                {rawSample && (
                  <details className="bg-bg border border-border rounded-lg px-3 py-2 text-[11px]">
                    <summary className="cursor-pointer text-text-muted font-medium">Most recent cached event raw JSON</summary>
                    <pre className="mt-2 bg-surface border border-border rounded p-2 overflow-x-auto text-[10px] max-h-72">{JSON.stringify(rawSample, null, 2)}</pre>
                  </details>
                )}
                {abcDetail && (
                  <details open className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-[11px]">
                    <summary className="cursor-pointer text-blue-900 font-medium">
                      Live ABC response (path: <code>{abcDetail.matched_path || 'none matched'}</code>)
                    </summary>
                    {abcDetail.error && <div className="mt-1 text-red-700">{abcDetail.error}</div>}
                    {abcDetail.attempts && (
                      <div className="mt-1 text-[10px] text-blue-900">
                        Tried: {abcDetail.attempts.map(a => `${a.path}=${a.status}`).join(' · ')}
                      </div>
                    )}
                    {abcDetail.body && (
                      <pre className="mt-2 bg-surface border border-blue-200 rounded p-2 overflow-x-auto text-[10px] max-h-72">{JSON.stringify(abcDetail.body, null, 2)}</pre>
                    )}
                    <p className="mt-1 text-[10px] text-blue-900">
                      Look for a training-levels array in the body above. Copy the <code>levelId</code> (or <code>id</code>) of the level you want into the manual input.
                    </p>
                  </details>
                )}
              </div>

              {/* Member search */}
              <label className="block">
                <span className="block text-xs font-medium text-text-muted mb-1">Member</span>
                {selectedMember ? (
                  <div className="flex items-center justify-between bg-bg border border-border rounded-lg px-3 py-2">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{selectedMember.first_name} {selectedMember.last_name}</div>
                      <div className="text-[10px] text-text-muted">#{selectedMember.member_id} · {selectedMember.email || ''}</div>
                    </div>
                    <button onClick={() => { setSelectedMember(null); setMemberQuery('') }} className="text-xs text-wcs-red hover:underline">Change</button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={memberQuery}
                      onChange={e => setMemberQuery(e.target.value)}
                      placeholder="Search by name, email, or barcode (min 2 chars)"
                      className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
                    />
                    {memberSearchPending && <span className="text-[10px] text-text-muted mt-1 block">Searching…</span>}
                    {memberResults.length > 0 && (
                      <div className="mt-1 border border-border rounded-lg max-h-40 overflow-y-auto">
                        {memberResults.map(m => (
                          <button
                            key={m.member_id}
                            onClick={() => { setSelectedMember(m); setMemberQuery(''); setMemberResults([]) }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-bg border-b border-border last:border-0"
                          >
                            <div className="font-medium text-text-primary">{m.first_name} {m.last_name}</div>
                            <div className="text-[10px] text-text-muted">{m.email || ''} · {m.barcode || ''}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </label>

              {/* Trainer */}
              <label className="block">
                <span className="block text-xs font-medium text-text-muted mb-1">Trainer</span>
                <select
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red"
                >
                  <option value="">— select —</option>
                  {employees.map(emp => (
                    <option key={emp.employee_id} value={emp.employee_id}>{emp.display_name}</option>
                  ))}
                </select>
              </label>

              {/* Date / time / duration */}
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="block text-xs font-medium text-text-muted mb-1">Date</span>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red" />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-text-muted mb-1">Time</span>
                  <input type="time" value={time} onChange={e => setTime(e.target.value)} step="900"
                    className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red" />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-text-muted mb-1">Duration</span>
                  <select value={duration} onChange={e => setDuration(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-wcs-red">
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={45}>45 min</option>
                    <option value={60}>60 min</option>
                    <option value={75}>75 min</option>
                    <option value={90}>90 min</option>
                  </select>
                </label>
              </div>

              {/* Allow unfunded — book the session even with no funded sessions on file */}
              <label className="flex items-start gap-2 text-xs text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowUnfunded}
                  onChange={e => setAllowUnfunded(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-wcs-red"
                />
                <span>
                  <span className="font-semibold">Allow unfunded</span>
                  <span className="block text-text-muted">Book even if the member has no funded PT sessions remaining.</span>
                </span>
              </label>

              {submitError && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{submitError}</div>}
              {success && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 text-sm">{success}</div>}

              {debugResponse && (
                <details className="bg-bg border border-border rounded-lg px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-text-muted font-medium">ABC response</summary>
                  <pre className="mt-2 bg-surface border border-border rounded p-2 overflow-x-auto text-[10px]">{JSON.stringify(debugResponse, null, 2)}</pre>
                </details>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 sticky bottom-0 bg-surface">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">
            {success ? 'Close' : 'Cancel'}
          </button>
          {!success && (
            <button
              onClick={submit}
              disabled={submitting || loading}
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

// Place overlapping events side-by-side within a day column.
// Returns each event with { laneIndex, laneCount } so the render layer can size.
export default function PtSchedulerView() {
  const [club, setClub] = useState(CLUB_NUMBERS[0])
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [events, setEvents] = useState([])
  const [sources, setSources] = useState(null)
  const [allEmployees, setAllEmployees] = useState([])
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [bookOpen, setBookOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0) // bump after a mutation to refetch
  const scrollRef = useRef(null)

  // Fetch week's events whenever club, week, or reloadKey changes
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

  function refetchEvents() { setReloadKey(k => k + 1) }

  // Fetch active employees for the club so the trainer filter shows ALL
  // active staff (not just whoever happens to have an event this week).
  useEffect(() => {
    let cancelled = false
    async function loadEmployees() {
      try {
        const r = await api(`/abc-scheduler/employees?club_number=${encodeURIComponent(club.clubNumber)}`)
        if (!cancelled) setAllEmployees(r.employees || [])
      } catch (_) {
        if (!cancelled) setAllEmployees([])
      }
    }
    loadEmployees()
    return () => { cancelled = true }
  }, [club])

  // Auto-scroll the grid so 7 AM is visible on first render
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 60
  }, [])

  // Trainer list — merge the full active-employees roster (so trainers
  // without events this week still appear) with anyone seen in this week's
  // events (which keeps the dropdown functional if /employees is empty/down).
  const trainers = useMemo(() => {
    const byId = new Map()
    for (const emp of allEmployees) {
      if (!emp.employee_id) continue
      byId.set(emp.employee_id, {
        id: emp.employee_id,
        name: emp.display_name || [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown',
      })
    }
    for (const e of events) {
      if (!e.employee_id || byId.has(e.employee_id)) continue
      byId.set(e.employee_id, {
        id: e.employee_id,
        name: [e.employee_first_name, e.employee_last_name].filter(Boolean).join(' ') || 'Unknown',
      })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [allEmployees, events])

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
        <span className="font-semibold">Experimental — write access live.</span> Booking, attendance, and cancellation hit the real ABC. Test changes will affect production club data.
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
          {/* Book event */}
          <button
            onClick={() => setBookOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red-hover"
          >
            + Book event
          </button>
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

      {/* Data source diagnostic — shows which ABC status filter actually
          returns events. If everything is 0, ABC isn't returning anything
          for this club/date range; if one row has http != 200, that's the
          error to act on. */}
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
        <SessionBalanceModal
          event={selectedEvent}
          clubNumber={club.clubNumber}
          onClose={() => setSelectedEvent(null)}
          onMutated={refetchEvents}
        />
      )}

      {bookOpen && (
        <BookEventModal
          club={club}
          defaultDate={weekStart}
          onClose={() => setBookOpen(false)}
          onCreated={refetchEvents}
        />
      )}
    </div>
  )
}
