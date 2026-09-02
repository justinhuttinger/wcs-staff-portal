import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { parseLocalTimestamp } from '../../lib/weekGrid'
import EditScopeToggle from '../schedule/EditScopeToggle'

const DAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

// "06:00" + 60 -> "07:00". Only used to keep the end time ahead of the start
// when the start is dragged past it.
function plusHour(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '')
  if (!m) return '07:00'
  const total = Math.min(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + 60, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

// Weekday of a date string, so switching to "all from here on" defaults the
// pills to the day this occurrence already sits on rather than making staff
// re-pick it.
function weekdayOf(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null
  return new Date(iso + 'T00:00:00Z').getUTCDay()
}

// [1, 3, 5] -> "Mon, Wed, Fri", in week order rather than sorted-number order,
// so the helper text under the pills reads the way a person would say it.
function weekdayLabels(values) {
  const set = new Set(values)
  return DAYS.filter(d => set.has(d.value)).map(d => d.label).join(', ')
}

// "HH:mm" from event.duration_minutes added to a start time, for seeding the
// end field from an event that only carries a duration.
function endFromDuration(hhmm, minutes) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '')
  const dur = Number(minutes)
  if (!m || !Number.isFinite(dur)) return plusHour(hhmm)
  const total = Math.min(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + dur, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// `event` is the WeekGrid-shaped object FacilityView hands out (toGridShape),
// not the raw API row -- event_id / class_name / instructor_name /
// event_timestamp_local / duration_minutes / series_id.
export default function EditEventModal({ club, facility, event, onClose, onSaved }) {
  const parsed = parseLocalTimestamp(event.event_timestamp_local)
  const startTime = parsed ? `${String(parsed.hour).padStart(2, '0')}:${String(parsed.min).padStart(2, '0')}` : '06:00'
  const occurrenceDate = parsed?.date || ''

  const hasSeries = !!event.series_id

  const [scope, setScope] = useState('one')
  const [title, setTitle] = useState(event.class_name || '')
  const [staffName, setStaffName] = useState(event.instructor_name || '')
  const [date, setDate] = useState(occurrenceDate)
  const [time, setTime] = useState(startTime)
  const [endTime, setEndTime] = useState(endFromDuration(startTime, event.duration_minutes))
  const [weekdays, setWeekdays] = useState([])

  const [step, setStep] = useState('form')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Set only on a "created but could not remove the old one" outcome (the
  // response carries the new event_id). Facility events are a plain
  // Supabase UPDATE today, so this route can't actually produce that
  // outcome yet -- kept here so this modal fails the same safe way
  // EditClassModal.jsx does if a future edit path here ever becomes a
  // create-then-cancel against an external calendar. Once set, a retry
  // is never offered: it would create a THIRD event on top of the two
  // that already exist.
  const [duplicate, setDuplicate] = useState(null)

  // Switching to "all from here on" pre-selects the series' ACTUAL current
  // weekday set, not just the day of the occurrence that was clicked -- a
  // Mon/Wed/Fri series clicked on its Monday would otherwise seed only
  // Monday, and applying without noticing would silently drop Wed and Fri
  // from the schedule. A one-off event has no series pattern to inherit, so
  // it still falls back to its own day.
  useEffect(() => {
    if (scope !== 'forward' || weekdays.length > 0) return
    if (Array.isArray(event.series_weekdays) && event.series_weekdays.length > 0) {
      setWeekdays([...event.series_weekdays].sort())
      return
    }
    const d = weekdayOf(occurrenceDate)
    if (d !== null) setWeekdays([d])
  }, [scope]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDay(v) {
    setWeekdays(ds => (ds.includes(v) ? ds.filter(d => d !== v) : [...ds, v].sort()))
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (scope === 'one') {
        await api(`/facility-schedule/events/${encodeURIComponent(event.event_id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            club_number: club.clubNumber,
            facility: facility.slug,
            title: title.trim(),
            staff_name: staffName.trim() || null,
            date,
            time,
            end_time: endTime,
          }),
        })
        onSaved()
        return
      }
      // "All from here on" is a rewrite of every future row in the series, so
      // show what that touches before writing anything -- same shape as
      // CreateEventModal's recurring preview.
      const r = await api(`/facility-schedule/series/${encodeURIComponent(event.series_id)}/edit-preview/${occurrenceDate}`, {
        method: 'POST',
        body: JSON.stringify({
          club_number: club.clubNumber,
          facility: facility.slug,
          title: title.trim(),
          staff_name: staffName.trim() || null,
          weekdays,
          start_time: time,
          end_time: endTime,
        }),
      })
      if (!r.count) {
        setError('Those days produce no events. Check the weekday selection.')
        return
      }
      setPreview(r)
      setStep('confirm')
    } catch (err) {
      if (err.event_id) {
        setDuplicate({ eventId: err.event_id, message: err.message })
      } else {
        setError(err.message || 'Could not save the event')
      }
    } finally {
      setBusy(false)
    }
  }

  async function applySeries() {
    setBusy(true)
    setError(null)
    try {
      await api(`/facility-schedule/series/${encodeURIComponent(event.series_id)}/from/${occurrenceDate}`, {
        method: 'PUT',
        body: JSON.stringify({
          club_number: club.clubNumber,
          facility: facility.slug,
          title: title.trim(),
          staff_name: staffName.trim() || null,
          weekdays,
          start_time: time,
          end_time: endTime,
        }),
      })
      onSaved()
    } catch (err) {
      if (err.event_id) {
        setDuplicate({ eventId: err.event_id, message: err.message })
      } else {
        setError(err.message || 'Could not save the series')
      }
    } finally {
      setBusy(false)
    }
  }

  async function cancelThisEvent() {
    if (!window.confirm(`Remove ${title || event.class_name} on ${occurrenceDate}?`)) return
    setBusy(true)
    setError(null)
    try {
      await api(`/facility-schedule/events/${encodeURIComponent(event.event_id)}?club_number=${club.clubNumber}&facility=${facility.slug}`, { method: 'DELETE' })
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not remove the event')
      setBusy(false)
    }
  }

  // Keeps the event currently open on screen and removes everything after it.
  // `through` is inclusive of what is KEPT, so passing this occurrence's own
  // date is what leaves it untouched -- see the DELETE /series contract.
  async function cancelRest() {
    if (!window.confirm(`Cancel every event in this series after ${fmtDate(occurrenceDate)}? This event stays.`)) return
    setBusy(true)
    setError(null)
    try {
      const qs = `club_number=${club.clubNumber}&facility=${facility.slug}&through=${occurrenceDate}`
      await api(`/facility-schedule/series/${encodeURIComponent(event.series_id)}?${qs}`, { method: 'DELETE' })
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not cancel the rest of the series')
      setBusy(false)
    }
  }

  const canSubmit = title.trim() && time && endTime && !busy
    && (scope === 'one' ? !!date : weekdays.length > 0)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-text-primary">
            {duplicate ? 'Event created, old one still live'
              : step === 'confirm'
              ? `Confirm ${preview?.count} events`
              : `Edit ${facility.label} event at ${club.name}`}
          </h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        {duplicate && (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">
              {duplicate.message}
            </div>
            <p className="text-sm text-text-primary">
              The new event (id {duplicate.eventId}) is already live on the calendar. Saving again from
              here would create a third event, so this form is closed -- remove the old one by hand,
              then close this and refresh to see the current schedule.
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onSaved}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover">Close</button>
            </div>
          </div>
        )}

        {!duplicate && step === 'form' && (
          <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto">
            <EditScopeToggle scope={scope} onChange={setScope} hasSeries={hasSeries} />

            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} required maxLength={80}
                placeholder="Lap Swim, Open Pickleball, Swim Lessons"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              {scope === 'one' ? (
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Date</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} required
                    className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-surface text-text-primary" />
                </div>
              ) : (
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-text-muted mb-1">Repeats on</label>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map(d => (
                      <button key={d.value} type="button" onClick={() => toggleDay(d.value)}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                          weekdays.includes(d.value)
                            ? 'bg-wcs-red text-white border-wcs-red font-medium'
                            : 'border-border text-text-primary hover:bg-bg'
                        }`}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted mt-1.5">
                    {Array.isArray(event.series_weekdays) && event.series_weekdays.length > 0
                      ? `This series currently runs ${weekdayLabels(event.series_weekdays)}. `
                      : ''}
                    Changing the days above changes which days the series runs from here on.
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Starts</label>
                <input type="time" value={time} required
                  onChange={e => {
                    setTime(e.target.value)
                    // Keep the end ahead of the start rather than letting it go
                    // stale and fail validation on submit.
                    if (endTime <= e.target.value) setEndTime(plusHour(e.target.value))
                  }}
                  className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-surface text-text-primary" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Ends</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required
                  className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-surface text-text-primary" />
              </div>
            </div>

            {scope === 'forward' && (
              <p className="text-xs text-text-muted">
                Applies from {fmtDate(occurrenceDate)} onward. Events before that date are untouched.
              </p>
            )}

            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Staff name (optional)</label>
              <input type="text" value={staffName} onChange={e => setStaffName(e.target.value)} maxLength={60}
                placeholder="Leave blank for open swim or open court"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{error}</div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" onClick={cancelThisEvent} disabled={busy}
                className="px-4 py-2 text-sm rounded-lg border border-red-300 bg-red-50 text-red-900 font-medium hover:bg-red-100 disabled:opacity-50 mr-auto">
                Cancel this event
              </button>
              {hasSeries && (
                <button type="button" onClick={cancelRest} disabled={busy}
                  className="px-4 py-2 text-sm rounded-lg border border-red-300 bg-red-50 text-red-900 font-medium hover:bg-red-100 disabled:opacity-50">
                  Cancel this and all after
                </button>
              )}
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Close</button>
              <button type="submit" disabled={!canSubmit}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
                {busy ? 'Working...' : scope === 'forward' ? 'Preview dates' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {!duplicate && step === 'confirm' && preview && (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary">
              This changes <strong>{preview.count}</strong> {facility.label.toLowerCase()} events at {club.name}
              {preview.replaced ? `, replacing ${preview.replaced} already on the calendar` : ''}.
            </div>

            <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {preview.occurrences.map(o => (
                <div key={o.date} className="px-3 py-1.5 text-sm text-text-primary">{fmtDate(o.date)}</div>
              ))}
            </div>

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{error}</div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setStep('form'); setError(null) }} disabled={busy}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg disabled:opacity-50">Back</button>
              <button type="button" onClick={applySeries} disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
                {busy ? `Saving ${preview.count}...` : `Save ${preview.count} events`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
