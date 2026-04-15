import { useState, useEffect } from 'react'
import { getTrainerAvailability, updateTrainerAvailability } from '../lib/api'

const LOCATIONS = [
  { slug: 'salem', label: 'Salem' },
  { slug: 'keizer', label: 'Keizer' },
  { slug: 'eugene', label: 'Eugene' },
  { slug: 'springfield', label: 'Springfield' },
  { slug: 'clackamas', label: 'Clackamas' },
  { slug: 'milwaukie', label: 'Milwaukie' },
  { slug: 'medford', label: 'Medford' },
]

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_LABELS = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' }

// Map numeric day (0=Sun, 1=Mon, ..., 6=Sat) to day name
const NUM_TO_DAY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function parseSchedule(schedule) {
  const result = {}
  for (const day of DAYS) {
    result[day] = { enabled: false, from: '09:00', to: '17:00' }
  }
  if (!schedule) return result

  const rules = Array.isArray(schedule) ? schedule : schedule.rules || schedule.openHours || []
  if (!Array.isArray(rules)) return result

  for (const rule of rules) {
    // Format 1: { type: 'wday', day: 'monday', intervals: [{ from, to }] }
    if (rule.type === 'wday' && rule.day && rule.intervals?.length > 0) {
      result[rule.day] = { enabled: true, from: rule.intervals[0].from || '09:00', to: rule.intervals[0].to || '17:00' }
    }
    // Format 2: { daysOfTheWeek: [1, 2], hours: [{ openHour, openMinute, closeHour, closeMinute }] }
    else if (rule.daysOfTheWeek && rule.hours?.length > 0) {
      const h = rule.hours[0]
      const from = `${String(h.openHour).padStart(2, '0')}:${String(h.openMinute || 0).padStart(2, '0')}`
      const to = `${String(h.closeHour).padStart(2, '0')}:${String(h.closeMinute || 0).padStart(2, '0')}`
      for (const dayNum of rule.daysOfTheWeek) {
        const dayName = NUM_TO_DAY[dayNum]
        if (dayName) result[dayName] = { enabled: true, from, to }
      }
    }
    // Format 3: { dOW: ['monday'], hours: [...] }
    else if (rule.dOW && rule.hours?.length > 0) {
      const h = rule.hours[0]
      const from = `${String(h.openHour).padStart(2, '0')}:${String(h.openMinute || 0).padStart(2, '0')}`
      const to = `${String(h.closeHour).padStart(2, '0')}:${String(h.closeMinute || 0).padStart(2, '0')}`
      for (const day of rule.dOW) {
        if (day) result[day.toLowerCase()] = { enabled: true, from, to }
      }
    }
  }
  return result
}

function buildRules(schedule) {
  const rules = []
  for (const day of DAYS) {
    const s = schedule[day]
    if (s.enabled) {
      rules.push({ type: 'wday', day, intervals: [{ from: s.from, to: s.to }] })
    }
  }
  return rules
}

function TrainerScheduleCard({ trainer, locationSlug, onUpdated }) {
  const [schedule, setSchedule] = useState(() => parseSchedule(trainer.schedule?.rules || trainer.schedule))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  function toggleDay(day) {
    setSchedule(prev => ({ ...prev, [day]: { ...prev[day], enabled: !prev[day].enabled } }))
    setSaved(false)
  }

  function setTime(day, field, value) {
    setSchedule(prev => ({ ...prev, [day]: { ...prev[day], [field]: value } }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      if (!trainer.scheduleId) {
        setError('No schedule found — set availability in GHL first')
        setSaving(false)
        return
      }
      await updateTrainerAvailability(trainer.scheduleId, {
        location_slug: locationSlug,
        rules: buildRules(schedule),
        timezone: 'America/Los_Angeles',
      })
      setSaved(true)
      if (onUpdated) onUpdated()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{trainer.name}</h3>
          <p className="text-xs text-text-muted">{trainer.email}</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-600">Saved</span>}
          {error && <span className="text-xs text-wcs-red">{error}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-wcs-red text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {DAYS.map(day => (
          <div key={day} className="flex items-center gap-3">
            <button
              onClick={() => toggleDay(day)}
              className={`w-12 text-xs font-medium rounded-lg py-1.5 text-center transition-colors ${
                schedule[day].enabled
                  ? 'bg-wcs-red text-white'
                  : 'bg-bg text-text-muted border border-border'
              }`}
            >
              {DAY_LABELS[day]}
            </button>
            {schedule[day].enabled ? (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={schedule[day].from}
                  onChange={e => setTime(day, 'from', e.target.value)}
                  className="px-2 py-1 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
                />
                <span className="text-xs text-text-muted">to</span>
                <input
                  type="time"
                  value={schedule[day].to}
                  onChange={e => setTime(day, 'to', e.target.value)}
                  className="px-2 py-1 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
                />
              </div>
            ) : (
              <span className="text-xs text-text-muted">Unavailable</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TrainerAvailabilityView({ user, onBack, location, isAdmin }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const defaultSlug = (location || 'Salem').toLowerCase()
  const [locationSlug, setLocationSlug] = useState(defaultSlug)

  useEffect(() => { loadData() }, [locationSlug])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const res = await getTrainerAvailability({ location_slug: locationSlug })
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-6">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-text-primary hover:border-text-muted transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <h2 className="text-xl font-bold text-text-primary">Trainer Availability</h2>
        {data?.calendarName && (
          <p className="text-xs text-text-muted mt-1">Calendar: {data.calendarName}</p>
        )}

        {isAdmin ? (
          <div className="flex flex-wrap gap-2 mt-4">
            {LOCATIONS.map(loc => (
              <button
                key={loc.slug}
                onClick={() => setLocationSlug(loc.slug)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  locationSlug === loc.slug
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-bg text-text-muted border-border hover:text-text-primary hover:border-text-muted'
                }`}
              >
                {loc.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted mt-3 uppercase tracking-wide font-semibold">{location}</p>
        )}
      </div>

      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}
      {loading && <p className="text-text-muted text-sm py-8 text-center">Loading availability...</p>}

      {!loading && data && (
        <div className="space-y-4">
          {(data.trainers || []).length === 0 && (
            <div className="text-center py-8">
              <p className="text-text-muted text-sm">
                {data.calendarName ? 'No trainers found on this calendar' : 'No "Day One" calendar found at this location'}
              </p>
              {data.debug && <p className="text-xs text-text-muted mt-2">{data.debug}</p>}
            </div>
          )}
          {(data.trainers || []).map(trainer => (
            <TrainerScheduleCard
              key={trainer.userId}
              trainer={trainer}
              locationSlug={locationSlug}
              onUpdated={loadData}
            />
          ))}
        </div>
      )}
    </div>
  )
}
