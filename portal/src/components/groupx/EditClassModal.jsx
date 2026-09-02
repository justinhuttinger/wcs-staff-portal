import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { parseLocalTimestamp } from '../../lib/weekGrid'
import EditScopeToggle from '../schedule/EditScopeToggle'

const DAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

// Weekday of a date string, so switching to "all from here on" falls back to
// the day this occurrence already sits on when the real pattern can't be
// worked out from what's loaded.
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

// `event` is one row from GET /group-x/classes -- event_id / event_type_id /
// employee_id / class_name / instructor_name / event_timestamp_local /
// series_id / series_source / is_new / new_source.
export default function EditClassModal({ club, classTypes, instructors, event, onClose, onSaved }) {
  const parsed = parseLocalTimestamp(event.event_timestamp_local)
  const startTime = parsed ? `${String(parsed.hour).padStart(2, '0')}:${String(parsed.min).padStart(2, '0')}` : '06:00'
  const occurrenceDate = parsed?.date || ''

  const hasSeries = !!event.series_id

  const [scope, setScope] = useState('one')
  const [eventTypeId, setEventTypeId] = useState(event.event_type_id || '')
  const [employeeId, setEmployeeId] = useState(event.employee_id || '')
  const [date, setDate] = useState(occurrenceDate)
  const [time, setTime] = useState(startTime)
  const [levelId, setLevelId] = useState('')
  const [weekdays, setWeekdays] = useState([])
  // True once the operator has touched a pill by hand. Until then the pills
  // hold nothing but the single day that was clicked, and the server's
  // edit-preview response (the series' actual stored pattern, not a client
  // guess) is allowed to correct them -- see submit().
  const [weekdaysTouched, setWeekdaysTouched] = useState(false)
  // The series' real weekday pattern, learned from the server the first time
  // edit-preview answers. Null until then, so the helper text under the
  // pills never claims a pattern it hasn't actually confirmed.
  const [seriesWeekdays, setSeriesWeekdays] = useState(null)

  const [step, setStep] = useState('form')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [badgeBusy, setBadgeBusy] = useState(false)
  const [error, setError] = useState(null)
  // Set only on the "created but could not remove the old one" outcome (the
  // response carries the new event_id). Once set, the class already has a
  // live duplicate in ABC, so the form is retired rather than left
  // resubmittable -- a retry would create a THIRD class on top of the two
  // that already exist.
  const [duplicate, setDuplicate] = useState(null)

  const selectedType = classTypes.find(t => t.event_type_id === eventTypeId) || null
  const selectedInstructor = instructors.find(i => i.employee_id === employeeId) || null
  // A class type that isn't in the loaded dropdown (deleted or renamed in ABC
  // since this class was created) would otherwise leave class_name undefined
  // on the wire, and the server 400s about a field the operator can plainly
  // see filled in on screen. Fall back to the class's own current name rather
  // than silently sending nothing.
  const resolvedClassName = selectedType?.name || event.class_name || null

  // Auto-select the training level when the chosen class type has exactly
  // one, same as CreateClassModal -- true for all 6 WCS class types today.
  useEffect(() => {
    if (!selectedType) return
    const levels = selectedType.training_levels || []
    setLevelId(levels.length === 1 ? levels[0].level_id : '')
  }, [eventTypeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Switching to "all from here on" starts the pills with only the day that
  // was clicked -- a real pattern, not a guess. The full pattern arrives from
  // the server on the first edit-preview response (see submit()) and
  // replaces this as long as the operator hasn't touched a pill by hand.
  useEffect(() => {
    if (scope !== 'forward' || weekdays.length > 0) return
    const d = weekdayOf(occurrenceDate)
    if (d !== null) setWeekdays([d])
  }, [scope]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDay(v) {
    setWeekdaysTouched(true)
    setWeekdays(ds => (ds.includes(v) ? ds.filter(d => d !== v) : [...ds, v].sort()))
  }

  async function submit(e) {
    e.preventDefault()
    if (!resolvedClassName) {
      setError('This class type is no longer available. Pick a class from the list before saving.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (scope === 'one') {
        await api(`/group-x/classes/${encodeURIComponent(event.event_id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            club_number: club.clubNumber,
            event_type_id: eventTypeId,
            employee_id: employeeId,
            date,
            time,
            training_level_id: levelId || null,
            class_name: resolvedClassName,
            old_date: occurrenceDate,
          }),
        })
        onSaved()
        return
      }
      // "All from here on" rewrites every future occurrence, so show what
      // that touches before writing anything -- same shape as
      // CreateClassModal's recurring preview.
      let r = await api(`/group-x/series/${encodeURIComponent(event.series_id)}/edit-preview/${occurrenceDate}`, {
        method: 'POST',
        body: JSON.stringify({
          club_number: club.clubNumber,
          event_type_id: eventTypeId,
          employee_id: employeeId,
          weekdays,
          start_time: time,
          training_level_id: levelId || null,
          class_name: resolvedClassName,
        }),
      })

      // The server just told us the series' real weekday pattern. If the
      // operator hasn't touched a pill yet, the current selection is only
      // the single day that was clicked -- correct it to the truth and
      // re-preview so the confirm screen (and the actual write) reflects the
      // real pattern rather than that one-day placeholder.
      const truth = Array.isArray(r.weekdays) ? [...r.weekdays].sort() : []
      const current = [...weekdays].sort()
      if (!weekdaysTouched && truth.length && truth.join(',') !== current.join(',')) {
        setSeriesWeekdays(truth)
        setWeekdays(truth)
        r = await api(`/group-x/series/${encodeURIComponent(event.series_id)}/edit-preview/${occurrenceDate}`, {
          method: 'POST',
          body: JSON.stringify({
            club_number: club.clubNumber,
            event_type_id: eventTypeId,
            employee_id: employeeId,
            weekdays: truth,
            start_time: time,
            training_level_id: levelId || null,
            class_name: resolvedClassName,
          }),
        })
      } else if (truth.length) {
        setSeriesWeekdays(truth)
      }

      if (!r.count) {
        setError('Those days produce no classes. Check the weekday selection.')
        return
      }
      setPreview(r)
      setStep('confirm')
    } catch (err) {
      // A cancel_failed edit is not a plain failure -- the NEW class already
      // exists in ABC. Surfacing that plainly and stopping here matters: a
      // "just try again" retry would create a third class on top of the two
      // that already exist, so the form is retired instead of left
      // resubmittable.
      if (err.event_id) {
        setDuplicate({ eventId: err.event_id, message: err.message })
      } else {
        setError(err.message || 'Could not save the class')
      }
    } finally {
      setBusy(false)
    }
  }

  async function applySeries() {
    setBusy(true)
    setError(null)
    try {
      const r = await api(`/group-x/series/${encodeURIComponent(event.series_id)}/from/${occurrenceDate}`, {
        method: 'PUT',
        body: JSON.stringify({
          club_number: club.clubNumber,
          event_type_id: eventTypeId,
          employee_id: employeeId,
          // Without this the server falls back to series.instructor_name, so
          // changing the instructor here would leave the series row showing
          // the OLD name next to the NEW employee_id.
          instructor_name: selectedInstructor?.display_name || null,
          weekdays,
          start_time: time,
          training_level_id: levelId || null,
          class_name: resolvedClassName,
        }),
      })
      // Partial failure is shown as partial failure, never dressed up as
      // success -- same result panel CreateClassModal already uses. The
      // result step itself only ever offers Done, never a resubmit, so a
      // duplicate here is already handled the same way a single-class one
      // is: no retry path exists to create a third class.
      setResult(r)
      setStep('result')
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
    if (!window.confirm(`Cancel ${event.class_name} on ${fmtDate(occurrenceDate)}? This removes it from the ABC calendar.`)) return
    setBusy(true)
    setError(null)
    try {
      await api(`/group-x/classes/${encodeURIComponent(event.event_id)}?club_number=${club.clubNumber}&date=${encodeURIComponent(occurrenceDate)}`, { method: 'DELETE' })
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not cancel the class')
      setBusy(false)
    }
  }

  // Keeps the class currently open on screen and removes everything after
  // it. `through` is inclusive of what is KEPT, so passing this occurrence's
  // own date is what leaves it untouched -- see the DELETE /series contract.
  async function cancelRest() {
    if (!window.confirm(`Cancel every class in this series after ${fmtDate(occurrenceDate)}? This class stays.`)) return
    setBusy(true)
    setError(null)
    try {
      const qs = `club_number=${club.clubNumber}&through=${occurrenceDate}`
      const r = await api(`/group-x/series/${encodeURIComponent(event.series_id)}?${qs}`, { method: 'DELETE' })
      if (r.failed) {
        setError(`${r.canceled} cancelled, ${r.failed} could not be cancelled in ABC.`)
        setBusy(false)
        return
      }
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not cancel the rest of the series')
      setBusy(false)
    }
  }

  // Badge/unbadge this one scheduled class. Moved in from the old read-only
  // popover -- the "we added a Saturday Yoga and Friday Yoga is not new" case
  // that a class-type badge can't express on its own.
  async function toggleBadge() {
    setBadgeBusy(true)
    setError(null)
    try {
      if (event.is_new && event.new_source === 'session') {
        await api(`/group-x/new-classes/events/${encodeURIComponent(event.event_id)}?club_number=${club.clubNumber}`, { method: 'DELETE' })
      } else {
        const d = new Date()
        d.setDate(d.getDate() + 30)
        const until = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        await api('/group-x/new-classes/events', {
          method: 'PUT',
          body: JSON.stringify({
            club_number: club.clubNumber,
            abc_event_id: event.event_id,
            class_name: event.class_name,
            show_until: until,
          }),
        })
      }
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not update the New badge')
      setBadgeBusy(false)
    }
  }

  const canSubmit = eventTypeId && employeeId && time && !!resolvedClassName && !busy
    && (scope === 'one' ? !!date : weekdays.length > 0)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-text-primary">
            {duplicate ? 'Class created, old one still live'
              : step === 'confirm' ? `Confirm ${preview?.count} classes`
              : step === 'result' ? 'Result'
              : `Edit class at ${club.name}`}
          </h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        {duplicate && (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">
              {duplicate.message}
            </div>
            <p className="text-sm text-text-primary">
              The new class (id {duplicate.eventId}) is already live on the calendar. Saving again from
              here would create a third class, so this form is closed -- cancel the old one by hand on
              the ABC calendar, then close this and refresh to see the current schedule.
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onSaved}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover">Close</button>
            </div>
          </div>
        )}

        {!duplicate && step === 'form' && (
          <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto">
            <EditScopeToggle scope={scope} onChange={setScope} hasSeries={hasSeries} seriesSource={event.series_source} />

            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Class</label>
              <select value={eventTypeId} onChange={e => setEventTypeId(e.target.value)} required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary">
                <option value="">Select a class</option>
                {classTypes.map(t => (
                  <option key={t.event_type_id} value={t.event_type_id}>
                    {t.name}{t.max_attendees ? ` (max ${t.max_attendees})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Instructor</label>
              <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary">
                <option value="">Select an instructor</option>
                {instructors.map(i => (
                  <option key={i.employee_id} value={i.employee_id}>
                    {i.display_name} ({i.department})
                  </option>
                ))}
              </select>
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
                    {seriesWeekdays
                      ? `This series currently runs ${weekdayLabels(seriesWeekdays)}. `
                      : 'Only the day you clicked is checked so far -- the full pattern is confirmed on the preview screen. '}
                    Changing the days above changes which days the series runs from here on.
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Start time</label>
                <input type="time" value={time} onChange={e => setTime(e.target.value)} required
                  className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-surface text-text-primary" />
              </div>
              <div>
                {/* Read-only: ABC takes duration from the class type and
                    ignores anything sent on an update. An editable box here
                    would lie -- change the Class above to change the length. */}
                <label className="block text-xs font-medium text-text-muted mb-1">Length</label>
                <div className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-muted">
                  {selectedType?.duration_minutes ? `${selectedType.duration_minutes} min` : 'Set by class'}
                </div>
              </div>
            </div>

            {scope === 'forward' && (
              <p className="text-xs text-text-muted">
                Applies from {fmtDate(occurrenceDate)} onward. Classes before that date are untouched.
              </p>
            )}

            {(selectedType?.training_levels?.length || 0) > 1 && (
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Training level</label>
                <select value={levelId} onChange={e => setLevelId(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary">
                  <option value="">Select a level</option>
                  {selectedType.training_levels.map(l => (
                    <option key={l.level_id} value={l.level_id}>{l.level_name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="rounded-lg border border-border p-3">
              <button type="button" onClick={toggleBadge} disabled={badgeBusy}
                className="w-full text-left flex items-center justify-between text-sm text-text-primary">
                <span>
                  {event.is_new
                    ? `New badge${event.new_source === 'class' ? ' (whole class type)' : ' (this class only)'}`
                    : 'Show a New class badge for this class'}
                </span>
                <span className="text-xs font-medium text-wcs-red">
                  {badgeBusy
                    ? 'Saving...'
                    : event.is_new && event.new_source === 'class' ? null
                    : event.is_new ? 'Remove' : 'Mark as new'}
                </span>
              </button>
              {event.is_new && event.new_source === 'class' && (
                <p className="text-xs text-text-muted mt-1">
                  This badge comes from the whole class type. Remove it under New badges.
                </p>
              )}
            </div>

            {!resolvedClassName && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This class's type is no longer in the list above. Pick a class before saving.
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{error}</div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" onClick={cancelThisEvent} disabled={busy}
                className="px-4 py-2 text-sm rounded-lg border border-red-300 bg-red-50 text-red-900 font-medium hover:bg-red-100 disabled:opacity-50 mr-auto">
                Cancel this class
              </button>
              {hasSeries && (
                <button type="button" onClick={cancelRest} disabled={busy}
                  className="px-4 py-2 text-sm rounded-lg border border-red-300 bg-red-50 text-red-900 font-medium hover:bg-red-100 disabled:opacity-50">
                  Cancel every class after this one
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
              This changes <strong>{preview.count}</strong> classes at {club.name}
              {preview.replacing ? `, replacing ${preview.replacing} already on the calendar` : ''}.
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
                {busy ? `Saving ${preview.count}...` : `Save ${preview.count} classes`}
              </button>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="p-5 space-y-4 overflow-y-auto">
            {result.failed === 0 ? (
              <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
                Saved: {result.created} created, {result.canceled} cancelled.
              </div>
            ) : (
              <>
                {/* Partial failure is stated plainly, never dressed up as success. */}
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {result.created} created, {result.canceled} cancelled, {result.failed} failed.
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {result.occurrences.filter(o => !o.ok).map(o => (
                    <div key={o.date} className="px-3 py-2 text-sm">
                      <div className="text-text-primary font-medium">{fmtDate(o.date)}</div>
                      <div className="text-xs text-red-800 break-words">{o.error}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {!result.series_updated && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 break-words">
                The repeating pattern itself was left unchanged, so the series will keep running its
                old schedule until this is retried. {result.series_update_error}
              </div>
            )}
            {result.link_error && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 break-words">
                Classes were saved, but could not be linked to the series for future edits: {result.link_error}
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={onSaved}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
