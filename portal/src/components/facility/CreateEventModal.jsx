import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

const DAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

// "06:00" + 60 -> "07:00". Only used to seed a sensible default end time.
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

// Weekday of a date string, so ticking "recurring" can default to the day the
// event already sits on rather than making staff re-pick it.
function weekdayOf(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null
  return new Date(iso + 'T00:00:00Z').getUTCDay()
}

export default function CreateEventModal({ club, facility, defaultDate, defaultTime, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [staffName, setStaffName] = useState('')
  const [date, setDate] = useState(defaultDate || '')
  const [time, setTime] = useState(defaultTime || '06:00')
  const [endTime, setEndTime] = useState(plusHour(defaultTime || '06:00'))

  // Recurring lives here rather than behind its own button: adding a repeating
  // slot is the same act as adding a one-off, just with more detail.
  const [recurring, setRecurring] = useState(false)
  const [weekdays, setWeekdays] = useState([])
  const [noEndDate, setNoEndDate] = useState(false)
  const [endsOn, setEndsOn] = useState('')

  const [step, setStep] = useState('form')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Ticking recurring pre-selects the day the event already falls on.
  useEffect(() => {
    if (!recurring || weekdays.length > 0) return
    const d = weekdayOf(date)
    if (d !== null) setWeekdays([d])
  }, [recurring]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDay(v) {
    setWeekdays(ds => (ds.includes(v) ? ds.filter(d => d !== v) : [...ds, v].sort()))
  }

  const seriesBody = {
    club_number: club.clubNumber,
    facility: facility.slug,
    title: title.trim(),
    staff_name: staffName.trim() || null,
    weekdays,
    start_time: time,
    end_time: endTime,
    starts_on: date,
    ends_on: noEndDate ? null : endsOn,
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (!recurring) {
        await api('/facility-schedule/events', {
          method: 'POST',
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
        onCreated()
        return
      }
      // Repeating: show the dates before writing anything.
      const r = await api('/facility-schedule/series/preview', {
        method: 'POST',
        body: JSON.stringify(seriesBody),
      })
      if (!r.count) {
        setError('Those days and dates produce no events. Check the weekday selection.')
        return
      }
      setPreview(r)
      setStep('confirm')
    } catch (err) {
      setError(err.message || 'Could not save the event')
    } finally {
      setBusy(false)
    }
  }

  async function createSeries() {
    setBusy(true)
    setError(null)
    try {
      await api('/facility-schedule/series', { method: 'POST', body: JSON.stringify(seriesBody) })
      onCreated()
    } catch (err) {
      setError(err.message || 'Could not create the series')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = title.trim() && date && time && endTime && !busy
    && (!recurring || (weekdays.length > 0 && (noEndDate || endsOn)))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-text-primary">
            {step === 'confirm'
              ? `Confirm ${preview?.count} events`
              : `Add ${facility.label} event at ${club.name}`}
          </h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        {step === 'form' && (
          <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} required maxLength={80}
                placeholder="Lap Swim, Open Pickleball, Swim Lessons"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  {recurring ? 'First date' : 'Date'}
                </label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} required
                  className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-surface text-text-primary" />
              </div>
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

            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Staff name (optional)</label>
              <input type="text" value={staffName} onChange={e => setStaffName(e.target.value)} maxLength={60}
                placeholder="Leave blank for open swim or open court"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
            </div>

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
                      Runs until you end it. Dates are added a few months ahead and topped up
                      automatically.
                    </p>
                  )}
                </>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 break-words">{error}</div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-bg">Cancel</button>
              <button type="submit" disabled={!canSubmit}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
                {busy ? 'Working...' : recurring ? 'Preview dates' : 'Add event'}
              </button>
            </div>
          </form>
        )}

        {step === 'confirm' && preview && (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary">
              This adds <strong>{preview.count}</strong> {facility.label.toLowerCase()} events at {club.name}.
              {preview.open_ended && ' More are added automatically as time goes on.'}
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
              <button type="button" onClick={createSeries} disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50">
                {busy ? `Adding ${preview.count}...` : `Add ${preview.count} events`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
