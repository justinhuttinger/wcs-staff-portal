import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function CreateSeriesModal({ club, classTypes, instructors, defaultDate, onClose, onCreated }) {
  // form -> confirm -> result. Nothing is written to ABC until the user has
  // seen the exact list of dates on the confirm step.
  const [step, setStep] = useState('form')
  const [eventTypeId, setEventTypeId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [weekdays, setWeekdays] = useState([])
  const [time, setTime] = useState('06:00')
  const [startsOn, setStartsOn] = useState(defaultDate || '')
  const [endsOn, setEndsOn] = useState('')
  const [levelId, setLevelId] = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const selectedType = classTypes.find(t => t.event_type_id === eventTypeId) || null
  const selectedInstructor = instructors.find(i => i.employee_id === employeeId) || null

  useEffect(() => {
    if (!selectedType) return
    const levels = selectedType.training_levels || []
    setLevelId(levels.length === 1 ? levels[0].level_id : '')
  }, [eventTypeId]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDay(v) {
    setWeekdays(ds => (ds.includes(v) ? ds.filter(d => d !== v) : [...ds, v].sort()))
  }

  const body = {
    club_number: club.clubNumber,
    event_type_id: eventTypeId,
    employee_id: employeeId,
    class_name: selectedType?.name,
    instructor_name: selectedInstructor?.display_name,
    weekdays,
    start_time: time,
    duration_minutes: selectedType?.duration_minutes || 60,
    training_level_id: levelId || null,
    starts_on: startsOn,
    ends_on: endsOn,
  }

  async function doPreview(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api('/group-x/series/preview', { method: 'POST', body: JSON.stringify(body) })
      if (!r.count) {
        setError('Those days and dates produce no classes. Check the weekday selection.')
        return
      }
      setPreview(r)
      setStep('confirm')
    } catch (err) {
      setError(err.message || 'Could not work out the dates')
    } finally {
      setBusy(false)
    }
  }

  async function doCreate() {
    setBusy(true)
    setError(null)
    try {
      const r = await api('/group-x/series', { method: 'POST', body: JSON.stringify(body) })
      setResult(r)
      setStep('result')
    } catch (err) {
      setError(err.message || 'Could not create the series')
    } finally {
      setBusy(false)
    }
  }

  const canPreview = eventTypeId && employeeId && weekdays.length > 0 && time && startsOn && endsOn && !busy

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-text-primary">
            {step === 'form' && `Repeating class at ${club.name}`}
            {step === 'confirm' && `Confirm ${preview?.count} classes`}
            {step === 'result' && 'Result'}
          </h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        {step === 'form' && (
          <form onSubmit={doPreview} className="p-5 space-y-4 overflow-y-auto">
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
                  <option key={i.employee_id} value={i.employee_id}>{i.display_name} ({i.department})</option>
                ))}
              </select>
            </div>

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

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Time</label>
                <input type="time" value={time} onChange={e => setTime(e.target.value)} required
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">First class</label>
                <input type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} required
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Last class</label>
                <input type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} required
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{error}</div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Cancel</button>
              <button type="submit" disabled={!canPreview}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
                {busy ? 'Working out dates...' : 'Preview dates'}
              </button>
            </div>
          </form>
        )}

        {step === 'confirm' && preview && (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This creates <strong>{preview.count}</strong> real classes on the ABC calendar for {club.name}.
              Cancelling them afterwards is one click per class, or one click for the whole series.
            </div>

            <div>
              <div className="text-xs font-medium text-text-muted mb-1">
                {selectedType?.name} with {selectedInstructor?.display_name} at {time}
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {preview.occurrences.map(o => (
                  <div key={o.date} className="px-3 py-1.5 text-sm text-text-primary">{fmtDate(o.date)}</div>
                ))}
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{error}</div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setStep('form'); setError(null) }} disabled={busy}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg disabled:opacity-50">Back</button>
              <button type="button" onClick={doCreate} disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
                {busy ? `Creating ${preview.count} classes...` : `Create ${preview.count} classes`}
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
                {/* Partial failure is stated as partial failure, never dressed
                    up as success. Only the failed dates are listed. */}
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
