import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

// Badges default to a month out. Long enough that members notice, short enough
// that a forgotten badge ages off by itself.
function plus30() {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

// Weekday of a date string, so ticking "recurring" defaults to the day the
// class already sits on rather than making staff re-pick it.
function weekdayOf(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null
  return new Date(iso + 'T00:00:00Z').getUTCDay()
}

export default function CreateClassModal({ club, classTypes, instructors, defaultDate, defaultTime, onClose, onCreated }) {
  const [eventTypeId, setEventTypeId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState(defaultDate || '')
  const [time, setTime] = useState(defaultTime || '06:00')
  const [levelId, setLevelId] = useState('')
  const [markNew, setMarkNew] = useState(false)
  const [newUntil, setNewUntil] = useState(plus30())
  // Recurring lives here rather than behind its own button: scheduling a
  // repeating class is the same act as scheduling one, with more detail.
  const [recurring, setRecurring] = useState(false)
  const [weekdays, setWeekdays] = useState([])
  const [noEndDate, setNoEndDate] = useState(false)
  const [endsOn, setEndsOn] = useState('')
  const [step, setStep] = useState('form')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selectedType = classTypes.find(t => t.event_type_id === eventTypeId) || null
  const selectedInstructor = instructors.find(i => i.employee_id === employeeId) || null

  function toggleDay(v) {
    setWeekdays(ds => (ds.includes(v) ? ds.filter(d => d !== v) : [...ds, v].sort()))
  }

  // Auto-select the training level when the class type has exactly one, which
  // is the case for all 6 WCS class types today.
  useEffect(() => {
    if (!selectedType) return
    const levels = selectedType.training_levels || []
    setLevelId(levels.length === 1 ? levels[0].level_id : '')
  }, [eventTypeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ticking recurring pre-selects the day the class already falls on.
  useEffect(() => {
    if (!recurring || weekdays.length > 0) return
    const d = weekdayOf(date)
    if (d !== null) setWeekdays([d])
  }, [recurring]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api('/group-x/classes', {
        method: 'POST',
        body: JSON.stringify({
          club_number: club.clubNumber,
          event_type_id: eventTypeId,
          employee_id: employeeId,
          date,
          time,
          training_level_id: levelId || null,
          class_name: selectedType?.name,
          mark_new: markNew,
          new_until: markNew ? newUntil : null,
        }),
      })
      onCreated()
    } catch (err) {
      // Surface ABC's own message. Its API-CAL-EVT-* codes are the diagnostic,
      // and hiding them behind "something went wrong" wastes everyone's time.
      setError(err.message || 'Failed to create the class')
    } finally {
      setSaving(false)
    }
  }

  const seriesBody = {
    club_number: club.clubNumber,
    event_type_id: eventTypeId,
    employee_id: employeeId,
    class_name: selectedType?.name,
    instructor_name: selectedInstructor?.display_name,
    weekdays,
    start_time: time,
    duration_minutes: selectedType?.duration_minutes || 60,
    training_level_id: levelId || null,
    starts_on: date,
    ends_on: noEndDate ? null : endsOn,
    mark_new: markNew,
    new_until: markNew ? newUntil : null,
  }

  async function submitForm(e) {
    e.preventDefault()
    if (!recurring) return submit(e)
    // Repeating: show the exact dates before writing anything to ABC.
    setSaving(true)
    setError(null)
    try {
      const r = await api('/group-x/series/preview', { method: 'POST', body: JSON.stringify(seriesBody) })
      if (!r.count) {
        setError('Those days and dates produce no classes. Check the weekday selection.')
        return
      }
      setPreview(r)
      setStep('confirm')
    } catch (err) {
      setError(err.message || 'Could not work out the dates')
    } finally {
      setSaving(false)
    }
  }

  async function createSeries() {
    setSaving(true)
    setError(null)
    try {
      setResult(await api('/group-x/series', { method: 'POST', body: JSON.stringify(seriesBody) }))
      setStep('result')
    } catch (err) {
      setError(err.message || 'Could not create the series')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = eventTypeId && employeeId && date && time && !saving
    && (!recurring || (weekdays.length > 0 && (noEndDate || endsOn)))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-text-primary">
            {step === 'confirm' ? `Confirm ${preview?.count} classes`
              : step === 'result' ? 'Result'
              : `Add class at ${club.name}`}
          </h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        {step === 'form' && (
        <form onSubmit={submitForm} className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Class</label>
            <select
              value={eventTypeId}
              onChange={e => setEventTypeId(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary"
              required
            >
              <option value="">Select a class</option>
              {classTypes.map(t => (
                <option key={t.event_type_id} value={t.event_type_id}>
                  {t.name}{t.max_attendees ? ` (max ${t.max_attendees})` : ''}
                </option>
              ))}
            </select>
            {selectedType?.description && (
              <p className="mt-1 text-xs text-text-muted">{selectedType.description}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Instructor</label>
            <select
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary"
              required
            >
              <option value="">Select an instructor</option>
              {instructors.map(i => (
                <option key={i.employee_id} value={i.employee_id}>
                  {i.display_name} ({i.department})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>
            <div>
              {/* Read-only: ABC takes duration from the class type and ignores
                  any value sent on create. An editable box here would lie. */}
              <label className="block text-xs font-medium text-text-muted mb-1">Length</label>
              <div className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg text-text-muted">
                {selectedType?.duration_minutes ? `${selectedType.duration_minutes} min` : 'Set by class'}
              </div>
            </div>
          </div>

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

          <div className="rounded-lg border border-border p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} className="accent-wcs-red" />
              Recurring
            </label>

            {recurring && (
              <>
                <div>
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
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                    <input type="checkbox" checked={noEndDate} onChange={e => setNoEndDate(e.target.checked)} className="accent-wcs-red" />
                    No end date
                  </label>
                  {!noEndDate && (
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-1">Until</label>
                      <input type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} required={!noEndDate}
                        className="border border-border rounded-lg px-2 py-2 text-sm bg-surface text-text-primary" />
                    </div>
                  )}
                </div>

                {noEndDate && (
                  <p className="text-xs text-text-muted">
                    Runs until you end it. Classes are created a few months ahead in ABC and
                    topped up automatically.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input type="checkbox" checked={markNew} onChange={e => setMarkNew(e.target.checked)} className="accent-wcs-red" />
              Show a New class badge{recurring ? ' on every class in this series' : ' for this class'}
            </label>
            {markNew && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-text-muted">until</span>
                <input type="date" value={newUntil} onChange={e => setNewUntil(e.target.value)}
                  className="border border-border rounded-lg px-2 py-1 text-sm bg-surface text-text-primary" />
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              <div className="font-semibold mb-0.5">ABC rejected this class</div>
              <div className="break-words">{error}</div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit}
              className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
              {saving ? 'Working...' : recurring ? 'Preview dates' : 'Create class'}
            </button>
          </div>
        </form>
        )}

        {step === 'confirm' && preview && (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This creates <strong>{preview.count}</strong> real classes on the ABC calendar for {club.name}.
              {preview.open_ended && ' More are created automatically as time goes on.'}
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
              <button type="button" onClick={() => { setStep('form'); setError(null) }} disabled={saving}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg disabled:opacity-50">Back</button>
              <button type="button" onClick={createSeries} disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
                {saving ? `Creating ${preview.count} classes...` : `Create ${preview.count} classes`}
              </button>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="p-5 space-y-4 overflow-y-auto">
            {result.failed === 0 ? (
              <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
                Created {result.created} classes.
              </div>
            ) : (
              <>
                {/* Partial failure is stated plainly, never dressed up as success. */}
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Created {result.created} of {result.created + result.failed}. {result.failed} failed.
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
            {result.badge_error && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 break-words">
                Classes were created, but the New badge could not be saved: {result.badge_error}
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={onCreated}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
