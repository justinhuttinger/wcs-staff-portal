import { useState, useEffect } from 'react'
import { getTours } from '../lib/api'

function formatDate(dateStr) {
  // Parse as local date (not UTC) to avoid day-shift in Pacific time
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function getDateStr(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  // Use local date, not UTC (toISOString returns UTC which can be off by a day)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toLocalDateStr(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getWeekDates(baseDate) {
  const d = new Date(baseDate + 'T12:00:00') // noon to avoid DST edge cases
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  const dates = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    dates.push(toLocalDateStr(date))
  }
  return dates
}

const STATUS_COLORS = {
  confirmed: 'bg-green-50 text-green-700 border-green-200',
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  cancelled: 'bg-red-50 text-red-500 border-red-200',
  noshow: 'bg-gray-50 text-gray-500 border-gray-200',
  showed: 'bg-green-50 text-green-700 border-green-200',
}

export default function ToursView({ user, onBack }) {
  const [tours, setTours] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [locationName, setLocationName] = useState('')
  const [view, setView] = useState('day') // 'day' or 'week'
  const [currentDate, setCurrentDate] = useState(getDateStr())

  const userLocations = user?.staff?.locations || []
  const primaryId = userLocations.find(l => l.is_primary)?.id || userLocations[0]?.id
  const [locationId, setLocationId] = useState(primaryId)
  const hasMultipleLocations = userLocations.length > 1

  useEffect(() => { loadTours() }, [currentDate, view, locationId])

  async function loadTours() {
    if (!locationId) return
    setLoading(true)
    setError('')
    try {
      const params = { location_id: locationId }
      if (view === 'day') {
        params.start_date = currentDate
        params.end_date = currentDate
      } else {
        const week = getWeekDates(currentDate)
        params.start_date = week[0]
        params.end_date = week[6]
      }
      const res = await getTours(params)
      setTours(res.tours || [])
      setLocationName(res.location || '')
      if (res.message) setError(res.message)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  function navigateDate(offset) {
    const d = new Date(currentDate + 'T12:00:00')
    d.setDate(d.getDate() + (view === 'week' ? offset * 7 : offset))
    setCurrentDate(toLocalDateStr(d))
  }

  // Group tours by date for week view
  const toursByDate = {}
  if (view === 'week') {
    const weekDates = getWeekDates(currentDate)
    weekDates.forEach(date => { toursByDate[date] = [] })
    tours.forEach(tour => {
      const date = toLocalDateStr(new Date(tour.start_time))
      if (toursByDate[date]) toursByDate[date].push(tour)
    })
  }

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-text-primary">Tours</h2>
            {!hasMultipleLocations && locationName && <p className="text-sm text-text-muted">{locationName}</p>}
          </div>
          <div className="flex gap-1 bg-bg rounded-lg p-1">
            <button
              onClick={() => setView('day')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === 'day' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
              }`}
            >Day</button>
            <button
              onClick={() => setView('week')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === 'week' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
              }`}
            >Week</button>
          </div>
        </div>
        {hasMultipleLocations && (
          <div className="flex flex-wrap gap-2 mt-3">
            {userLocations.map(loc => (
              <button
                key={loc.id}
                onClick={() => setLocationId(loc.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  locationId === loc.id
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-surface text-text-muted border-border hover:text-text-primary hover:border-text-muted'
                }`}
              >
                {loc.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Date Navigation */}
      <div className="flex items-center justify-between mb-6 bg-surface border border-border rounded-xl px-4 py-3">
        <button onClick={() => navigateDate(-1)} className="text-text-muted hover:text-text-primary transition-colors p-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-center">
          {view === 'day' ? (
            <p className="text-sm font-semibold text-text-primary">{formatDate(currentDate)}</p>
          ) : (
            <p className="text-sm font-semibold text-text-primary">
              {formatDate(getWeekDates(currentDate)[0])} — {formatDate(getWeekDates(currentDate)[6])}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentDate !== getDateStr() && (
            <button
              onClick={() => setCurrentDate(getDateStr())}
              className="px-3 py-1 text-xs font-medium rounded-lg border border-wcs-red text-wcs-red hover:bg-wcs-red hover:text-white transition-colors"
            >
              Skip to Today
            </button>
          )}
          <button onClick={() => navigateDate(1)} className="text-text-muted hover:text-text-primary transition-colors p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}
      {loading && <p className="text-text-muted text-sm py-8 text-center">Loading tours...</p>}

      {/* Day View */}
      {!loading && view === 'day' && (
        <div className="space-y-3">
          {tours.length === 0 && (
            <p className="text-text-muted text-sm py-8 text-center">No tours scheduled for this day</p>
          )}
          {tours.map(tour => (
            <div key={tour.id} className="bg-surface border border-border rounded-xl p-4 flex items-center gap-4">
              <div className="text-center min-w-[60px]">
                <p className="text-lg font-bold text-wcs-red">{formatTime(tour.start_time)}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary">{tour.contact_name || tour.title}</p>
                {tour.contact_phone && <p className="text-xs text-text-muted">{tour.contact_phone}</p>}
                {tour.contact_email && <p className="text-xs text-text-muted">{tour.contact_email}</p>}
              </div>
              <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[tour.status] || STATUS_COLORS.confirmed}`}>
                {tour.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Week View */}
      {!loading && view === 'week' && (
        <div className="space-y-4">
          {getWeekDates(currentDate).map(date => {
            const dayTours = toursByDate[date] || []
            const isToday = date === getDateStr()
            return (
              <div key={date} className={`rounded-xl border ${isToday ? 'border-wcs-red' : 'border-border'} overflow-hidden`}>
                <div className={`px-4 py-2 text-xs font-semibold ${isToday ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted'}`}>
                  {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  {dayTours.length > 0 && <span className="ml-2">({dayTours.length})</span>}
                </div>
                {dayTours.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-text-muted">No tours</div>
                ) : (
                  <div className="divide-y divide-border">
                    {dayTours.map(tour => (
                      <div key={tour.id} className="px-4 py-3 flex items-center gap-3">
                        <span className="text-sm font-medium text-wcs-red min-w-[55px]">{formatTime(tour.start_time)}</span>
                        <span className="text-sm text-text-primary">{tour.contact_name || tour.title}</span>
                        <span className={`ml-auto shrink-0 px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[tour.status] || STATUS_COLORS.confirmed}`}>
                          {tour.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
