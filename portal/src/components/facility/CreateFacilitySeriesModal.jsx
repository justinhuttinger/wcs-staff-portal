import { useState } from 'react'
import { api } from '../../lib/api'

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

export default function CreateFacilitySeriesModal({ club, facility, defaultDate, onClose, onCreated }) {
  // Preview before writing, same as the Group X series builder: staff should
  // see the exact dates before a month of events lands on the board.
  const [step, setStep] = useState('form')
  const [title, setTitle] = useState('')
  const [staffName, setStaffName] = useState('')
  const [weekdays, setWeekdays] = useState([])
  const [time, setTime] = useState('06:00')
  const [duration, setDuration] = useState(60)
  const [startsOn, setStartsOn] = useState(defaultDate || '')
  const [endsOn, setEndsOn] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function toggleDay(v) {
    setWeekdays(ds => (ds.includes(v) ? ds.filter(d => d !== v) : [...ds, v].sort()))
  }

  const body = {
    club_number: club.clubNumber,
    facility: facility.slug,
    title: title.trim(),
    staff_name: staffName.trim() || null,
    weekdays,
    start_time: time,
    duration_minutes: duration,
    starts_on: startsOn,
    ends_on: endsOn,
  }

  async function doPreview(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api('/facility-schedule/series/preview', { method: 'POST', body: JSON.stringify(body) })
      if (!r.count) {
        setError('Those days and dates produce no events. Check the weekday selection.')
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
      await api('/facility-schedule/series', { method: 'POST', body: JSON.stringify(body) })
      onCreated()
    } catch (err) {
      setError(err.message || 'Could not create the series')
    } finally {
      setBusy(false)
    }
  }

  const canPreview = title.trim() && weekdays.length > 0 && time && startsOn && endsOn && duration > 0 && !busy

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-text-primary">
            {step === 'form' ? `Repeating ${facility.label} event` : `Confirm ${preview?.count} events`}
          </h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">&times;</button>
        </div>

        {step === 'form' && (
          <form onSubmit={doPreview} className="p-5 space-y-4 overflow-y-auto">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} required maxLength={80}
                placeholder="Lap Swim, Open Pickleball"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
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

            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Start</label>
                <input type="time" value={time} onChange={e => setTime(e.target.value)} required
                  className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-surface text-text-primary" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Mins</label>
                <input type="number" min="5" step="5" max="1440" value={duration}
                  onChange={e => setDuration(parseInt(e.target.value, 10) || 0)} required
                  className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-surface text-text-primary" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">First</label>
                <input type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} required
                  className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-surface text-text-primary" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Last</label>
                <input type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} required
                  className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-surface text-text-primary" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Staff name (optional)</label>
              <input type="text" value={staffName} onChange={e => setStaffName(e.target.value)} maxLength={60}
                placeholder="Leave blank for open swim or open court"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-text-primary" />
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
            <div className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary">
              This adds <strong>{preview.count}</strong> {facility.label.toLowerCase()} events at {club.name}.
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
              <button type="button" onClick={doCreate} disabled={busy}
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
