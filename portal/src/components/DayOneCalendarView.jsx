import { useState, useEffect } from 'react'
import { getDayOneTrackerAppointments } from '../lib/api'

function formatDate(dateStr) {
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
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  'no show': 'bg-red-50 text-red-500 border-red-200',
  cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
}

export default function DayOneCalendarView({ user, onBack, location }) {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('day')
  const [currentDate, setCurrentDate] = useState(getDateStr())

  const locationSlug = (location || 'Salem').toLowerCase()

  useEffect(() => { loadAppointments() }, [currentDate, view])

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
      // Sort by appointment time ascending
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

  // Filter appointments for the current day view
  const dayAppointments = view === 'day' ? appointments.filter(a => {
    if (!a.appointment_time) return true
    const aptDate = toLocalDateStr(new Date(a.appointment_time))
    return aptDate === currentDate
  }) : appointments

  // Group by date for week view
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
            <h2 className="text-xl font-bold text-text-primary">Day Ones</h2>
            <p className="text-sm text-text-muted">{location}</p>
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
              Today
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
      {loading && <p className="text-text-muted text-sm py-8 text-center">Loading appointments...</p>}

      {/* Day View */}
      {!loading && view === 'day' && (
        <div className="space-y-3">
          {dayAppointments.length === 0 && (
            <p className="text-text-muted text-sm py-8 text-center">No Day One appointments for this day</p>
          )}
          {dayAppointments.map(apt => {
            const status = getStatus(apt)
            return (
              <div key={apt.id} className="bg-surface border border-border rounded-xl p-4 flex items-center gap-4">
                <div className="text-center min-w-[60px]">
                  <p className="text-lg font-bold text-wcs-red">{formatTime(apt.appointment_time)}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary">{apt.contact_name || 'Unknown'}</p>
                  {apt.assigned_user_name && (
                    <p className="text-xs text-text-muted">Trainer: {apt.assigned_user_name}</p>
                  )}
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border capitalize ${
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
        <div className="space-y-4">
          {getWeekDates(currentDate).map(date => {
            const dayApts = aptsByDate[date] || []
            const isToday = date === getDateStr()
            return (
              <div key={date} className={`rounded-xl border ${isToday ? 'border-wcs-red' : 'border-border'} overflow-hidden`}>
                <div className={`px-4 py-2 text-xs font-semibold ${isToday ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted'}`}>
                  {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  {dayApts.length > 0 && <span className="ml-2">({dayApts.length})</span>}
                </div>
                {dayApts.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-text-muted">No appointments</div>
                ) : (
                  <div className="divide-y divide-border">
                    {dayApts.map(apt => {
                      const status = getStatus(apt)
                      return (
                        <div key={apt.id} className="px-4 py-3 flex items-center gap-3">
                          <span className="text-sm font-medium text-wcs-red min-w-[55px]">{formatTime(apt.appointment_time)}</span>
                          <span className="text-sm text-text-primary flex-1">{apt.contact_name || 'Unknown'}</span>
                          {apt.assigned_user_name && (
                            <span className="text-xs text-text-muted">{apt.assigned_user_name}</span>
                          )}
                          <span className={`ml-auto shrink-0 px-2 py-0.5 rounded-full text-xs border capitalize ${
                            STATUS_COLORS[status.toLowerCase()] || 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}>
                            {status}
                          </span>
                        </div>
                      )
                    })}
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
