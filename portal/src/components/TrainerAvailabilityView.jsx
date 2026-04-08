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

function parseRules(rules) {
  const schedule = {}
  for (const day of DAYS) {
    schedule[day] = { enabled: false, from: '09:00', to: '17:00' }
  }
  if (!rules) return schedule
  for (const rule of rules) {
    if (rule.type === 'wday' && rule.day && rule.intervals?.length > 0) {
      schedule[rule.day] = {
        enabled: true,
        from: rule.intervals[0].from || '09:00',
        to: rule.intervals[0].to || '17:00',
      }
    }
  }
  return schedule
}

function buildRules(schedule) {
  const rules = []
  for (const day of DAYS) {
    const s = schedule[day]
    if (s.enabled) {
      rules.push({
        type: 'wday',
        day,
        intervals: [{ from: s.from, to: s.to }],
      })
    }
  }
  return rules
}

function ScheduleEditor({ calendar, locationSlug, onUpdated }) {
  const [schedule, setSchedule] = useState(() => parseRules(calendar.schedule?.rules))
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
      const rules = buildRules(schedule)
      await updateTrainerAvailability(calendar.id, {
        location_slug: locationSlug,
        rules,
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
          <h3 className="text-sm font-semibold text-text-primary">{calendar.name}</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {calendar.teamMembers.map(m => m.name).join(', ') || 'No team members'}
          </p>
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
      <div className="mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <h2 className="text-xl font-bold text-text-primary">Trainer Availability</h2>
        <p className="text-xs text-text-muted mt-1">Manage Day One calendar availability</p>
      </div>

      {/* Location Selector (admin only) */}
      {isAdmin ? (
        <div className="flex flex-wrap gap-2 mb-6">
          {LOCATIONS.map(loc => (
            <button
              key={loc.slug}
              onClick={() => setLocationSlug(loc.slug)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                locationSlug === loc.slug
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary hover:border-text-muted'
              }`}
            >
              {loc.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-muted mb-6 uppercase tracking-wide font-semibold">{location}</p>
      )}

      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}
      {loading && <p className="text-text-muted text-sm py-8 text-center">Loading availability...</p>}

      {!loading && data && (
        <div className="space-y-4">
          {(data.calendars || []).length === 0 && (
            <p className="text-text-muted text-sm py-8 text-center">No Day One calendars found at this location</p>
          )}
          {(data.calendars || []).map(cal => (
            <ScheduleEditor key={cal.id} calendar={cal} locationSlug={locationSlug} onUpdated={loadData} />
          ))}
        </div>
      )}
    </div>
  )
}
