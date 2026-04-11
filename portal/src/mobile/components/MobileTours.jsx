import React, { useState, useEffect, useCallback } from 'react'
import { getTours } from '../../lib/api'

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

const STATUS_COLORS = {
  confirmed: 'bg-green-50 text-green-700 border-green-200',
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  cancelled: 'bg-red-50 text-red-500 border-red-200',
  noshow: 'bg-gray-50 text-gray-500 border-gray-200',
  showed: 'bg-green-50 text-green-700 border-green-200',
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
        params.date = date
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
      const tDate = t.appointment_time ? t.appointment_time.slice(0, 10) : t.date
      if (tDate && grouped[tDate]) grouped[tDate].push(t)
    })
    return grouped
  }

  function TourCard({ tour }) {
    const status = (tour.status || '').toLowerCase().replace(/\s+/g, '')
    const colorClass = STATUS_COLORS[status] || 'bg-gray-50 text-gray-500 border-gray-200'
    const time = formatTime(tour.appointment_time || tour.start_time)
    const name = tour.contact_name || tour.name || 'Unknown'
    const phone = tour.phone || tour.contact_phone || ''
    const email = tour.email || tour.contact_email || ''

    return (
      <div className="bg-surface rounded-2xl border border-border p-4 flex items-start gap-3">
        {/* Time */}
        <div className="flex-shrink-0 min-w-[60px]">
          <span className="text-lg font-bold text-wcs-red">{time || '--'}</span>
        </div>

        {/* Contact info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text-primary truncate">{name}</p>
          {phone && <p className="text-xs text-text-muted truncate">{phone}</p>}
          {email && <p className="text-xs text-text-muted truncate">{email}</p>}
        </div>

        {/* Status pill */}
        <span className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${colorClass}`}>
          {tour.status || 'New'}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* View toggle */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex bg-bg rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => setView('day')}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              view === 'day' ? 'bg-wcs-red text-white' : 'text-text-secondary'
            }`}
          >
            Day
          </button>
          <button
            onClick={() => setView('week')}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              view === 'week' ? 'bg-wcs-red text-white' : 'text-text-secondary'
            }`}
          >
            Week
          </button>
        </div>
      </div>

      {/* Location selector */}
      {userLocations.length > 1 && (
        <div className="px-4 pb-2 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {userLocations.map(loc => (
              <button
                key={loc.id}
                onClick={() => setSelectedLocation(loc.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border whitespace-nowrap transition-colors ${
                  selectedLocation === loc.id
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-surface text-text-secondary border-border'
                }`}
              >
                {loc.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Date navigation */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <button
          onClick={() => navigateDate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-border bg-surface active:bg-bg"
          aria-label="Previous"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-text-primary">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>

        <div className="flex-1 text-center">
          <p className="text-sm font-semibold text-text-primary">
            {view === 'day' ? formatDateLong(date) : `${formatDate(getWeekDates(date)[0])} - ${formatDate(getWeekDates(date)[6])}`}
          </p>
        </div>

        <button
          onClick={() => navigateDate(1)}
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-border bg-surface active:bg-bg"
          aria-label="Next"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-text-primary">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>

        {date !== today && (
          <button
            onClick={goToday}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-wcs-red text-white active:opacity-80"
          >
            Today
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin h-6 w-6 text-wcs-red" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
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
            <div className="flex flex-col gap-3">
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
                    <div key={dateStr} className="rounded-xl overflow-hidden border border-border">
                      {/* Day header */}
                      <button
                        onClick={() => toggleDay(dateStr)}
                        className={`w-full flex items-center justify-between px-4 py-3 text-left ${
                          isToday ? 'bg-wcs-red text-white' : 'bg-bg text-text-primary'
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
                        <div className="bg-surface">
                          {dayTours.length === 0 ? (
                            <p className="text-xs text-text-muted px-4 py-3">No tours</p>
                          ) : (
                            <div className="flex flex-col divide-y divide-border">
                              {dayTours.map((tour, i) => (
                                <div key={tour.id || i} className="px-4 py-3 flex items-start gap-3">
                                  <span className="text-sm font-bold text-wcs-red min-w-[55px]">
                                    {formatTime(tour.appointment_time || tour.start_time) || '--'}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-text-primary truncate">
                                      {tour.contact_name || tour.name || 'Unknown'}
                                    </p>
                                  </div>
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                                    STATUS_COLORS[(tour.status || '').toLowerCase().replace(/\s+/g, '')] || 'bg-gray-50 text-gray-500 border-gray-200'
                                  }`}>
                                    {tour.status || 'New'}
                                  </span>
                                </div>
                              ))}
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
