import { useState, useEffect } from 'react'
import { getDayOneTrackerAppointments } from '../../lib/api'

function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatDateShort(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
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
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  'no show': 'bg-red-50 text-red-500 border-red-200',
  cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
}

export default function MobileDayOneCalendar({ user }) {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('day')
  const [currentDate, setCurrentDate] = useState(getDateStr())
  const [collapsedDays, setCollapsedDays] = useState({})

  const userLocations = user?.staff?.locations || []
  const primaryName = userLocations.find(l => l.is_primary)?.name?.toLowerCase() || userLocations[0]?.name?.toLowerCase() || 'salem'
  const [selectedLocation, setSelectedLocation] = useState(
    userLocations.find(l => l.is_primary)?.name || userLocations[0]?.name || 'Salem'
  )
  const hasMultipleLocations = userLocations.length > 1
  const locationSlug = selectedLocation.toLowerCase()

  useEffect(() => { loadAppointments() }, [currentDate, view, locationSlug])

  async function loadAppointments() {
    setLoading(true)
    setError('')
    try {
      const params = { location_slug: locationSlug }
      if (view === 'day') {
        params.start_date = currentDate
        params.end_date = currentDate
      } else {
        const week = getWeekDates(currentDate)
        params.start_date = week[0]
        params.end_date = week[6]
      }
      const res = await getDayOneTrackerAppointments(params)
      const sorted = (res.appointments || []).sort((a, b) =>
        new Date(a.appointment_time) - new Date(b.appointment_time)
      )
      setAppointments(sorted)
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

  function getStatus(apt) {
    return apt.day_one_status || apt.status || 'scheduled'
  }

  function toggleDay(date) {
    setCollapsedDays(prev => ({ ...prev, [date]: !prev[date] }))
  }

  const dayAppointments = view === 'day' ? appointments.filter(a => {
    if (!a.appointment_time) return true
    const aptDate = toLocalDateStr(new Date(a.appointment_time))
    return aptDate === currentDate
  }) : appointments

  const aptsByDate = {}
  if (view === 'week') {
    const weekDates = getWeekDates(currentDate)
    weekDates.forEach(date => { aptsByDate[date] = [] })
    appointments.forEach(apt => {
      if (!apt.appointment_time) return
      const date = toLocalDateStr(new Date(apt.appointment_time))
      if (aptsByDate[date]) aptsByDate[date].push(apt)
    })
  }

  const todayStr = getDateStr()

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="bg-surface border-b border-border px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text-primary">Day Ones</h2>
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
        {hasMultipleLocations && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
            {userLocations.map(loc => (
              <button
                key={loc.id}
                onClick={() => setSelectedLocation(loc.name)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap shrink-0 transition-colors ${
                  selectedLocation === loc.name
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
              <p className="text-sm font-semibold text-text-primary truncate">{formatDate(currentDate)}</p>
            ) : (
              <p className="text-xs font-semibold text-text-primary">
                {formatDateShort(getWeekDates(currentDate)[0])} — {formatDateShort(getWeekDates(currentDate)[6])}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {currentDate !== todayStr && (
              <button
                onClick={() => setCurrentDate(getDateStr())}
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
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error && <p className="text-sm text-wcs-red mb-3">{error}</p>}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-wcs-red border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Day View */}
        {!loading && view === 'day' && (
          <div className="space-y-2">
            {dayAppointments.length === 0 && (
              <p className="text-text-muted text-sm py-12 text-center">No Day One appointments for this day</p>
            )}
            {dayAppointments.map(apt => {
              const status = getStatus(apt)
              return (
                <div key={apt.id} className="bg-surface border border-border rounded-xl p-3.5 flex items-start gap-3">
                  <div className="shrink-0">
                    <p className="text-base font-bold text-wcs-red leading-tight">{formatTime(apt.appointment_time)}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{apt.contact_name || 'Unknown'}</p>
                    {apt.assigned_user_name && (
                      <p className="text-xs text-text-muted mt-0.5">{apt.assigned_user_name}</p>
                    )}
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${
                    STATUS_COLORS[status.toLowerCase()] || 'bg-blue-50 text-blue-700 border-blue-200'
                  }`}>
                    {status}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Week View */}
        {!loading && view === 'week' && (
          <div className="space-y-2">
            {getWeekDates(currentDate).map(date => {
              const dayApts = aptsByDate[date] || []
              const isToday = date === todayStr
              const isCollapsed = collapsedDays[date]

              return (
                <div key={date} className={`rounded-xl border overflow-hidden ${isToday ? 'border-wcs-red' : 'border-border'}`}>
                  {/* Day header - tappable to collapse */}
                  <button
                    onClick={() => toggleDay(date)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left ${
                      isToday ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted'
                    }`}
                  >
                    <span className="text-xs font-semibold">
                      {formatDateShort(date)}
                    </span>
                    <div className="flex items-center gap-2">
                      {dayApts.length > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                          isToday ? 'bg-white/20 text-white' : 'bg-text-muted/10 text-text-muted'
                        }`}>
                          {dayApts.length}
                        </span>
                      )}
                      <svg
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Appointment list */}
                  {!isCollapsed && (
                    <>
                      {dayApts.length === 0 ? (
                        <div className="px-3.5 py-2.5 text-xs text-text-muted bg-surface">No appointments</div>
                      ) : (
                        <div className="divide-y divide-border bg-surface">
                          {dayApts.map(apt => {
                            const status = getStatus(apt)
                            return (
                              <div key={apt.id} className="px-3.5 py-2.5 flex items-center gap-2.5">
                                <span className="text-sm font-bold text-wcs-red shrink-0 min-w-[52px]">
                                  {formatTime(apt.appointment_time)}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-text-primary truncate">{apt.contact_name || 'Unknown'}</p>
                                </div>
                                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border capitalize ${
                                  STATUS_COLORS[status.toLowerCase()] || 'bg-blue-50 text-blue-700 border-blue-200'
                                }`}>
                                  {status}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
