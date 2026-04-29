import React, { useState, useEffect, useCallback } from 'react'
import { getTours } from '../../lib/api'
import MobileLoading from './MobileLoading'

// --- Date helpers ---
function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function formatDateLong(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}
function formatTime(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function getDateStr(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function getWeekDates(baseDate) {
  const d = new Date(baseDate + 'T12:00:00')
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

function normalizeStatus(raw) {
  const s = (raw || '').toLowerCase().replace(/\s+/g, '')
  if (s === 'cancelled') return 'Cancelled'
  if (s === 'showed' || s === 'completed' || s === 'noshow') return 'Completed'
  return 'Scheduled'
}

function statusBadgeClass(label) {
  switch (label) {
    case 'Cancelled': return 'bg-red-50 text-red-500 border-red-200'
    case 'Completed': return 'bg-green-50 text-green-700 border-green-200'
    default: return 'bg-yellow-50 text-yellow-700 border-yellow-200'
  }
}

export default function MobileTours({ user }) {
  const [view, setView] = useState('day') // 'day' | 'week'
  const [date, setDate] = useState(getDateStr())
  const [tours, setTours] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedDays, setExpandedDays] = useState({})

  const userLocations = user?.staff?.locations || []
  const primaryId = userLocations.find(l => l.is_primary)?.id || userLocations[0]?.id
  const [selectedLocation, setSelectedLocation] = useState(primaryId)

  const today = getDateStr()

  const fetchTours = useCallback(async () => {
    setLoading(true)
    try {
      const params = { location_id: selectedLocation }
      if (view === 'day') {
        params.start_date = date
        params.end_date = date
      } else {
        const week = getWeekDates(date)
        params.start_date = week[0]
        params.end_date = week[6]
      }
      const res = await getTours(params)
      setTours(res.tours || res.data || res || [])
    } catch (err) {
      console.error('Failed to fetch tours:', err)
      setTours([])
    } finally {
      setLoading(false)
    }
  }, [date, view, selectedLocation])

  useEffect(() => { fetchTours() }, [fetchTours])

  // Expand today by default in week view
  useEffect(() => {
    if (view === 'week') {
      setExpandedDays(prev => ({ ...prev, [today]: true }))
    }
  }, [view, today])

  function navigateDate(dir) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + (view === 'day' ? dir : dir * 7))
    setDate(toLocalDateStr(d))
  }

  function goToday() {
    setDate(getDateStr())
  }

  function toggleDay(dateStr) {
    setExpandedDays(prev => ({ ...prev, [dateStr]: !prev[dateStr] }))
  }

  // Group tours by date for week view
  function groupByDate(tourList) {
    const grouped = {}
    const week = getWeekDates(date)
    week.forEach(d => { grouped[d] = [] })
    tourList.forEach(t => {
      const timeStr = t.start_time || t.appointment_time
      if (!timeStr) return
      const tDate = toLocalDateStr(new Date(timeStr))
      if (grouped[tDate]) grouped[tDate].push(t)
    })
    return grouped
  }

  function TourCard({ tour }) {
    const status = normalizeStatus(tour.status)
    const colorClass = statusBadgeClass(status)
    const name = tour.contact_name || tour.name || 'Unknown'
    const phone = tour.phone || tour.contact_phone || ''
    const email = tour.email || tour.contact_email || ''
    const time = formatTime(tour.appointment_time || tour.start_time)

    return (
      <div className="w-full text-left bg-surface rounded-2xl border border-border p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text-primary truncate">{name}</p>
          <p className="text-xs text-text-muted mt-0.5">
            {time || '—'}
          </p>
          {phone && <p className="text-xs text-text-muted mt-0.5">{phone}</p>}
          {email && <p className="text-xs text-text-muted truncate mt-0.5">{email}</p>}
        </div>
        <span className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${colorClass}`}>
          {status}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="bg-surface border-b border-border px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text-primary">Gym Tours</h2>
          {/* Day/Week toggle */}
          <div className="flex bg-bg rounded-lg p-0.5">
            <button
              onClick={() => setView('day')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === 'day' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted'
              }`}
            >Day</button>
            <button
              onClick={() => setView('week')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === 'week' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted'
              }`}
            >Week</button>
          </div>
        </div>

        {/* Location pills - horizontal scroll */}
        {userLocations.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
            {userLocations.map(loc => (
              <button
                key={loc.id}
                onClick={() => setSelectedLocation(loc.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap shrink-0 transition-colors ${
                  selectedLocation === loc.id
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-surface text-text-muted border-border'
                }`}
              >
                {loc.name}
              </button>
            ))}
          </div>
        )}

        {/* Date Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigateDate(-1)}
            className="p-2 text-text-muted active:text-text-primary"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-center flex-1 min-w-0">
            {view === 'day' ? (
              <p className="text-sm font-semibold text-text-primary truncate">{formatDateLong(date)}</p>
            ) : (
              <p className="text-xs font-semibold text-text-primary">
                {formatDate(getWeekDates(date)[0])} — {formatDate(getWeekDates(date)[6])}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {date !== today && (
              <button
                onClick={goToday}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-wcs-red text-wcs-red active:bg-wcs-red active:text-white transition-colors"
              >
                Today
              </button>
            )}
            <button
              onClick={() => navigateDate(1)}
              className="p-2 text-text-muted active:text-text-primary"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <MobileLoading text="Loading..." className="py-16" />
        ) : view === 'day' ? (
          /* Day view */
          tours.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 mb-2 opacity-40">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              <p className="text-sm">No tours scheduled</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pt-2">
              {tours.map((tour, i) => <TourCard key={tour.id || i} tour={tour} />)}
            </div>
          )
        ) : (
          /* Week view */
          (() => {
            const grouped = groupByDate(tours)
            return (
              <div className="flex flex-col gap-2">
                {Object.entries(grouped).map(([dateStr, dayTours]) => {
                  const isToday = dateStr === today
                  const isExpanded = expandedDays[dateStr] !== false

                  return (
                    <div key={dateStr} className="rounded-2xl overflow-hidden border border-border">
                      {/* Day header */}
                      <button
                        onClick={() => toggleDay(dateStr)}
                        className={`w-full flex items-center justify-between px-4 py-3 text-left ${
                          isToday ? 'bg-wcs-red text-white' : 'bg-surface text-text-primary'
                        }`}
                      >
                        <span className="text-sm font-semibold">{formatDate(dateStr)}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${isToday ? 'text-white/80' : 'text-text-muted'}`}>
                            {dayTours.length} tour{dayTours.length !== 1 ? 's' : ''}
                          </span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={2}
                            stroke="currentColor"
                            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </div>
                      </button>

                      {/* Day tours */}
                      {isExpanded && (
                        <div className="bg-bg px-3 py-2">
                          {dayTours.length === 0 ? (
                            <p className="text-xs text-text-muted px-1 py-3">No tours</p>
                          ) : (
                            <div className="flex flex-col gap-2">
                              {dayTours.map((tour, i) => <TourCard key={tour.id || i} tour={tour} />)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()
        )}
      </div>
    </div>
  )
}
