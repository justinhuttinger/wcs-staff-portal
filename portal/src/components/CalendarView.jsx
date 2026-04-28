import { useState, useEffect, useRef } from 'react'
import { getTours, getDayOneTrackerAppointments, submitDayOneResult, getDayOneFieldOptions } from '../lib/api'

// --- Helpers ---

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

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
  return toLocalDateStr(d)
}

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getWeekDates(baseDate) {
  const d = new Date(baseDate + 'T12:00:00')
  const day = d.getDay()
  // Start on Sunday
  const sunday = new Date(d)
  sunday.setDate(d.getDate() - day)
  const dates = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(sunday)
    date.setDate(sunday.getDate() + i)
    dates.push(toLocalDateStr(date))
  }
  return dates
}

function isPast(iso) {
  if (!iso) return false
  return new Date(iso) < new Date()
}

function isCancelled(apt) {
  return (apt.status || '').toLowerCase().replace(/\s+/g, '') === 'cancelled'
}

function isDayOnePending(apt) {
  if (isCancelled(apt)) return false
  const s = (apt.day_one_status || '').toLowerCase()
  return (!s || s === 'scheduled' || s === 'confirmed') && isPast(apt.appointment_time)
}

function isDayOneCompleted(apt) {
  if (isCancelled(apt)) return false
  const s = (apt.day_one_status || '').toLowerCase()
  return s === 'completed' || s === 'no show' || apt.show_or_no_show === 'No Show'
}

function getDayOneStatus(apt) {
  const aptStatus = (apt.status || '').toLowerCase().replace(/\s+/g, '')
  if (aptStatus === 'cancelled') return 'Cancelled'
  const dayOneStatus = (apt.day_one_status || '').toLowerCase()
  if (dayOneStatus === 'completed') return 'Completed'
  if (dayOneStatus === 'no show' || dayOneStatus === 'no-show' || dayOneStatus === 'noshow') return 'No Show'
  return 'Scheduled'
}

function normalizeTourStatus(raw) {
  const s = (raw || '').toLowerCase().replace(/\s+/g, '')
  if (s === 'cancelled') return 'Cancelled'
  if (s === 'showed' || s === 'completed' || s === 'noshow') return 'Completed'
  return 'Scheduled'
}

const STATUS_COLORS = {
  Scheduled: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  Cancelled: 'bg-red-50 text-red-500 border-red-200',
  Completed: 'bg-green-50 text-green-700 border-green-200',
  'No Show': 'bg-red-50 text-red-600 border-red-200',
}

// --- OutcomeModal (from DayOneTrackerView) ---

function StatusBadge({ appointment }) {
  const s = appointment.day_one_status
  const sale = appointment.day_one_sale
  const apptStatus = (appointment.status || '').toLowerCase().replace(/\s+/g, '')
  if (apptStatus === 'cancelled') return <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-500 text-xs border border-red-200">Cancelled</span>
  if (s === 'No Show' || appointment.show_or_no_show === 'No Show') return <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs border border-red-200">No Show</span>
  if (s === 'Completed') {
    if (sale === 'Sale') return <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">Sale</span>
    if (sale === 'No Sale') return <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 text-xs border border-gray-200">No Sale</span>
    return <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">Completed</span>
  }
  return <span className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 text-xs border border-yellow-200">Scheduled</span>
}

function formatDateTime(iso) {
  if (!iso) return '\u2014'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function OutcomeModal({ appointment, locationSlug, onClose, onSubmitted }) {
  const [step, setStep] = useState(1)
  const [showNoShow, setShowNoShow] = useState(null)
  const [saleResult, setSaleResult] = useState(null)
  const [ptSaleType, setPtSaleType] = useState('')
  const [whyNoSale, setWhyNoSale] = useState('')
  const [fieldOptions, setFieldOptions] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getDayOneFieldOptions({ location_slug: locationSlug })
      .then(setFieldOptions)
      .catch(() => setFieldOptions({ pt_sale_types: [], no_sale_reasons: [] }))
  }, [locationSlug])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      const result = await submitDayOneResult({
        contact_id: appointment.contact_id,
        location_slug: locationSlug,
        show_no_show: showNoShow,
        sale_result: showNoShow === 'Show' ? saleResult : null,
        pt_sale_type: saleResult === 'Sale' ? ptSaleType : null,
        why_no_sale: saleResult === 'No Sale' ? whyNoSale : null,
      })
      onSubmitted(result.confirmed || {
        day_one_status: showNoShow === 'Show' ? 'Completed' : 'No Show',
        show_or_no_show: showNoShow,
        day_one_sale: showNoShow === 'Show' ? saleResult : null,
      })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  function handleShowNoShow(value) {
    setShowNoShow(value)
    if (value === 'No Show') setStep(4)
    else setStep(2)
  }

  function handleSaleResult(value) {
    setSaleResult(value)
    setStep(3)
  }

  const alreadyDone = isDayOneCompleted(appointment)
  const reviewItems = []
  if (showNoShow) reviewItems.push({ label: 'Attendance', value: showNoShow })
  if (showNoShow === 'Show' && saleResult) reviewItems.push({ label: 'Sale Result', value: saleResult })
  if (saleResult === 'Sale' && ptSaleType) reviewItems.push({ label: 'Sale Type', value: ptSaleType })
  if (saleResult === 'No Sale' && whyNoSale) reviewItems.push({ label: 'Reason', value: whyNoSale })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-2xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{capitalize(appointment.contact_name)}</h3>
            <p className="text-xs text-text-muted">{formatDateTime(appointment.appointment_time)}</p>
            {appointment.assigned_user_name && <p className="text-xs text-text-muted">Trainer: {appointment.assigned_user_name}</p>}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>

        {alreadyDone && (
          <div className="mb-4 p-3 rounded-lg bg-bg border border-border">
            <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Current Status</p>
            <div className="flex items-center gap-2">
              <StatusBadge appointment={appointment} />
              {appointment.day_one_sale && <span className="text-sm text-text-primary">{appointment.day_one_sale}</span>}
            </div>
            <p className="text-xs text-text-muted mt-2">You can update this result below.</p>
          </div>
        )}

        {error && <p className="text-wcs-red text-sm mb-4">{error}</p>}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-primary text-center mb-4">Did they show up?</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => handleShowNoShow('Show')} className="py-6 rounded-xl bg-green-50 border-2 border-green-200 text-green-700 font-bold text-lg hover:bg-green-100 transition-colors">Show</button>
              <button onClick={() => handleShowNoShow('No Show')} className="py-6 rounded-xl bg-red-50 border-2 border-red-200 text-red-600 font-bold text-lg hover:bg-red-100 transition-colors">No Show</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-primary text-center mb-4">Sale or No Sale?</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => handleSaleResult('Sale')} className="py-6 rounded-xl bg-green-50 border-2 border-green-200 text-green-700 font-bold text-lg hover:bg-green-100 transition-colors">Sale</button>
              <button onClick={() => handleSaleResult('No Sale')} className="py-6 rounded-xl bg-gray-50 border-2 border-gray-200 text-gray-600 font-bold text-lg hover:bg-gray-100 transition-colors">No Sale</button>
            </div>
            <button onClick={() => { setShowNoShow(null); setStep(1) }} className="text-xs text-text-muted hover:text-text-primary mt-2">Back</button>
          </div>
        )}

        {step === 3 && saleResult === 'Sale' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-text-primary text-center">What did they sell?</p>
            <select value={ptSaleType} onChange={e => setPtSaleType(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red">
              <option value="">Select sale type...</option>
              {(fieldOptions?.pt_sale_types || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            <button onClick={() => setStep(4)} disabled={!ptSaleType} className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50">Next</button>
            <button onClick={() => { setSaleResult(null); setStep(2) }} className="text-xs text-text-muted hover:text-text-primary">Back</button>
          </div>
        )}

        {step === 3 && saleResult === 'No Sale' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-text-primary text-center">Why no sale?</p>
            <textarea value={whyNoSale} onChange={e => setWhyNoSale(e.target.value)} placeholder="Enter reason..." rows={3} className="w-full px-4 py-3 rounded-xl border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red resize-none" />
            <button onClick={() => setStep(4)} disabled={!whyNoSale.trim()} className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50">Next</button>
            <button onClick={() => { setSaleResult(null); setStep(2) }} className="text-xs text-text-muted hover:text-text-primary">Back</button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-text-primary text-center mb-2">Review & Submit</p>
            <div className="rounded-xl bg-bg border border-border p-4 space-y-2">
              {reviewItems.map(item => (
                <div key={item.label} className="flex justify-between text-sm">
                  <span className="text-text-muted">{item.label}</span>
                  <span className="font-medium text-text-primary">{item.value}</span>
                </div>
              ))}
            </div>
            <button onClick={handleSubmit} disabled={submitting} className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50">
              {submitting ? 'Saving...' : 'Submit'}
            </button>
            <button onClick={() => { if (showNoShow === 'No Show') setStep(1); else if (saleResult) setStep(3); else setStep(2) }} className="w-full py-2 text-xs text-text-muted hover:text-text-primary transition-colors">
              Edit answers
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// --- Main CalendarView ---

export default function CalendarView({ user, onBack, location, isAdmin }) {
  const [tours, setTours] = useState([])
  const [dayOnes, setDayOnes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('week')
  const [currentDate, setCurrentDate] = useState(getDateStr())
  const [filter, setFilter] = useState('all') // 'all' | 'tours' | 'dayones'
  const [activeModal, setActiveModal] = useState(null) // pending D1 — editable
  const [detailModal, setDetailModal] = useState(null) // completed D1 — read-only

  const userLocations = user?.staff?.locations || []
  const primaryLoc = userLocations.find(l => l.is_primary) || userLocations[0]
  const [locationId, setLocationId] = useState(primaryLoc?.id)
  const [locationName, setLocationName] = useState(primaryLoc?.name || location || 'Salem')
  const hasMultipleLocations = userLocations.length > 1
  const locationSlug = locationName.toLowerCase()

  const calRequestRef = useRef(0)

  useEffect(() => {
    const id = ++calRequestRef.current
    setTours([])
    setDayOnes([])
    setLoading(true)
    setError('')

    const dateParams = {}
    if (view === 'day') {
      dateParams.start_date = currentDate
      dateParams.end_date = currentDate
    } else {
      const week = getWeekDates(currentDate)
      dateParams.start_date = week[0]
      dateParams.end_date = week[6]
    }

    Promise.all([
      locationId
        ? getTours({ location_id: locationId, ...dateParams }).catch(() => ({ tours: [] }))
        : Promise.resolve({ tours: [] }),
      getDayOneTrackerAppointments({ location_slug: locationSlug, ...dateParams }).catch(() => ({ appointments: [] })),
    ]).then(([toursRes, dayOneRes]) => {
      if (id !== calRequestRef.current) return
      setTours(toursRes.tours || [])
      setDayOnes((dayOneRes.appointments || []).sort((a, b) => new Date(a.appointment_time) - new Date(b.appointment_time)))
      setLoading(false)
    }).catch(err => {
      if (id !== calRequestRef.current) return
      setError(err.message)
      setLoading(false)
    })
  }, [currentDate, view, locationId, locationName])

  function navigateDate(offset) {
    const d = new Date(currentDate + 'T12:00:00')
    d.setDate(d.getDate() + (view === 'week' ? offset * 7 : offset))
    setCurrentDate(toLocalDateStr(d))
  }

  function selectLocation(loc) {
    setLocationId(loc.id)
    setLocationName(loc.name)
  }

  // Merge tours and day ones into unified items
  function getItemsForDate(dateStr) {
    const items = []

    if (filter !== 'dayones') {
      tours.forEach(tour => {
        const tourDate = toLocalDateStr(new Date(tour.start_time))
        if (tourDate === dateStr) {
          items.push({
            type: 'tour',
            id: 'tour-' + tour.id,
            time: tour.start_time,
            name: tour.contact_name || tour.title,
            phone: tour.contact_phone,
            email: tour.contact_email,
            status: normalizeTourStatus(tour.status),
            raw: tour,
          })
        }
      })
    }

    if (filter !== 'tours') {
      dayOnes.forEach(apt => {
        if (!apt.appointment_time) return
        const aptDate = toLocalDateStr(new Date(apt.appointment_time))
        if (aptDate === dateStr) {
          const pending = isDayOnePending(apt)
          items.push({
            type: 'dayone',
            id: 'dayone-' + apt.id,
            time: apt.appointment_time,
            name: capitalize(apt.contact_name || 'Unknown'),
            trainer: apt.assigned_user_name,
            status: getDayOneStatus(apt),
            sale: apt.day_one_sale,
            pending,
            raw: apt,
          })
        }
      })
    }

    // Sort by time
    items.sort((a, b) => new Date(a.time) - new Date(b.time))
    return items
  }

  const todayStr = getDateStr()
  const weekDates = getWeekDates(currentDate)

  // Count pending day ones for badge
  const pendingCount = dayOnes.filter(isDayOnePending).length

  function handleDayOneClick(apt) {
    if (isDayOnePending(apt)) {
      setActiveModal(apt)
    } else {
      setDetailModal(apt)
    }
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-8 py-6">
      {/* Header card */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-text-primary">Calendar</h2>
            {pendingCount > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-yellow-50 text-yellow-700 text-xs font-medium border border-yellow-200">
                {pendingCount} pending
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Filter Toggle */}
            <div className="flex gap-1 bg-bg rounded-lg p-1">
              {[
                { key: 'all', label: 'All' },
                { key: 'tours', label: 'Tours' },
                { key: 'dayones', label: 'Day Ones' },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    filter === f.key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
                  }`}
                >{f.label}</button>
              ))}
            </div>
            {/* View Toggle */}
            <div className="flex gap-1 bg-bg rounded-lg p-1">
              <button onClick={() => setView('day')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'day' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>Day</button>
              <button onClick={() => setView('week')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'week' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>Week</button>
            </div>
          </div>
        </div>
        {/* Location Selector */}
        {hasMultipleLocations && (
          <div className="flex flex-wrap gap-2 mt-3">
            {userLocations.map(loc => (
              <button
                key={loc.id}
                onClick={() => selectLocation(loc)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  locationId === loc.id
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-bg text-text-muted border-border hover:text-text-primary hover:border-text-muted'
                }`}
              >{loc.name}</button>
            ))}
          </div>
        )}
        {!hasMultipleLocations && <p className="text-sm text-text-muted mt-1">{locationName}</p>}
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
              {formatDate(weekDates[0])} — {formatDate(weekDates[6])}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentDate !== todayStr && (
            <button onClick={() => setCurrentDate(getDateStr())} className="px-3 py-1 text-xs font-medium rounded-lg border border-wcs-red text-wcs-red hover:bg-wcs-red hover:text-white transition-colors">
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
      {loading && <p className="mx-auto w-fit bg-surface text-text-primary text-sm px-4 py-2 my-6 rounded-lg border border-border shadow-sm block">Loading calendar...</p>}

      {/* Day View */}
      {!loading && view === 'day' && (
        <DayItems items={getItemsForDate(currentDate)} onDayOneClick={handleDayOneClick} />
      )}

      {/* Week View — Google Calendar style columns */}
      {!loading && view === 'week' && (
        <div className="border border-border rounded-xl overflow-hidden bg-surface">
          {/* Column headers */}
          <div className="grid grid-cols-7 border-b border-border">
            {weekDates.map(date => {
              const isToday = date === todayStr
              const d = new Date(date + 'T12:00:00')
              const dayNum = d.getDate()
              const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
              return (
                <div key={date} className={`text-center py-2.5 ${isToday ? 'bg-wcs-red/5' : ''} ${date !== weekDates[0] ? 'border-l border-border' : ''}`}>
                  <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">{dayName}</p>
                  <p className={`text-lg font-bold mt-0.5 ${isToday ? 'text-white bg-wcs-red w-8 h-8 rounded-full flex items-center justify-center mx-auto' : 'text-text-primary'}`}>
                    {dayNum}
                  </p>
                </div>
              )
            })}
          </div>
          {/* Column bodies */}
          <div className="grid grid-cols-7 min-h-[400px]">
            {weekDates.map(date => {
              const items = getItemsForDate(date)
              const isToday = date === todayStr
              return (
                <div key={date} className={`${isToday ? 'bg-wcs-red/[0.02]' : ''} ${date !== weekDates[0] ? 'border-l border-border' : ''} p-1.5 flex flex-col gap-1`}>
                  {items.map(item => (
                    <CalendarCard key={item.id} item={item} onDayOneClick={handleDayOneClick} />
                  ))}
                  {items.length === 0 && (
                    <p className="text-[10px] text-text-muted/50 text-center mt-4">—</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Outcome Modal for pending Day Ones (editable) */}
      {activeModal && (
        <OutcomeModal
          appointment={activeModal}
          locationSlug={locationSlug}
          onClose={() => setActiveModal(null)}
          onSubmitted={(confirmedFields) => {
            setDayOnes(prev => prev.map(a => a.id === activeModal.id ? { ...a, ...confirmedFields } : a))
            setActiveModal(null)
          }}
        />
      )}

      {/* Read-only detail modal for completed Day Ones */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDetailModal(null)}>
          <div className="bg-surface rounded-2xl border border-border w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-text-primary">{capitalize(detailModal.contact_name)}</h3>
                <p className="text-xs text-text-muted">{formatDateTime(detailModal.appointment_time)}</p>
                {detailModal.assigned_user_name && <p className="text-xs text-text-muted">Trainer: {detailModal.assigned_user_name}</p>}
              </div>
              <button onClick={() => setDetailModal(null)} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
            </div>

            <div className="rounded-xl bg-bg border border-border p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Attendance</span>
                <span className="font-medium text-text-primary">{detailModal.show_or_no_show || (getDayOneStatus(detailModal) === 'No Show' ? 'No Show' : 'Show')}</span>
              </div>
              {getDayOneStatus(detailModal) !== 'No Show' && detailModal.day_one_sale && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Sale Result</span>
                  <span className={`font-medium ${detailModal.day_one_sale === 'Sale' ? 'text-green-700' : 'text-text-primary'}`}>{detailModal.day_one_sale}</span>
                </div>
              )}
              {detailModal.day_one_sale === 'Sale' && detailModal.pt_sale_type && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">What Was Sold</span>
                  <span className="font-medium text-text-primary">{detailModal.pt_sale_type}</span>
                </div>
              )}
              {detailModal.day_one_sale && detailModal.day_one_sale !== 'Sale' && detailModal.why_no_sale && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Reason</span>
                  <span className="font-medium text-text-primary">{detailModal.why_no_sale}</span>
                </div>
              )}
              {detailModal.day_one_booking_team_member && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Booked By</span>
                  <span className="font-medium text-text-primary">{detailModal.day_one_booking_team_member}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <StatusBadge appointment={detailModal} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Sub-components ---

function TypeBadge({ type }) {
  if (type === 'tour') {
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 uppercase tracking-wider">Tour</span>
  }
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-600 border border-purple-200 uppercase tracking-wider">Day One</span>
}

function DayItems({ items, onDayOneClick }) {
  if (items.length === 0) {
    return <p className="mx-auto w-fit bg-surface text-text-primary text-sm px-4 py-2 my-6 rounded-lg border border-border shadow-sm block">No events for this day</p>
  }

  return (
    <div className="space-y-3">
      {items.map(item => {
        const clickable = item.type === 'dayone' && (item.pending || item.status === 'Completed' || item.status === 'No Show')
        return (
        <div
          key={item.id}
          onClick={clickable ? () => onDayOneClick(item.raw) : undefined}
          className={`bg-surface border rounded-xl p-4 flex items-center gap-4 transition-all ${
            item.pending
              ? 'border-yellow-300 bg-yellow-50/30 cursor-pointer hover:border-wcs-red/50 animate-[pulse_3s_ease-in-out_infinite]'
              : clickable
                ? 'border-border cursor-pointer hover:border-wcs-red/50'
                : 'border-border'
          }`}
        >
          <div className="text-center min-w-[60px]">
            <p className="text-lg font-bold text-wcs-red">{formatTime(item.time)}</p>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-semibold text-text-primary">{item.name}</p>
              <TypeBadge type={item.type} />
            </div>
            {item.type === 'tour' && (
              <>
                {item.phone && <p className="text-xs text-text-muted">{item.phone}</p>}
                {item.email && <p className="text-xs text-text-muted">{item.email}</p>}
              </>
            )}
            {item.type === 'dayone' && item.trainer && (
              <p className="text-xs text-text-muted">Trainer: {item.trainer}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!(item.type === 'tour' && item.status !== 'Cancelled') && (
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[item.status] || STATUS_COLORS.Scheduled}`}>
                {item.status}
              </span>
            )}
            {item.type === 'dayone' && item.sale && (
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                item.sale === 'Sale' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-orange-50 text-orange-600 border-orange-200'
              }`}>{item.sale}</span>
            )}
          </div>
        </div>
        )
      })}
    </div>
  )
}

function CalendarCard({ item, onDayOneClick }) {
  const clickable = item.type === 'dayone' && (item.pending || item.status === 'Completed' || item.status === 'No Show')
  const isTour = item.type === 'tour'
  const bgColor = item.pending
    ? 'bg-yellow-50 border-yellow-300 hover:border-yellow-400'
    : isTour
      ? 'bg-blue-50 border-blue-200 hover:border-blue-300'
      : 'bg-purple-50 border-purple-200 hover:border-purple-300'

  return (
    <div
      onClick={clickable ? () => onDayOneClick(item.raw) : undefined}
      className={`rounded-lg border px-2 py-1.5 text-left transition-all ${bgColor} ${
        clickable ? 'cursor-pointer hover:ring-1 hover:ring-wcs-red/30' : ''
      } ${item.pending ? 'animate-[pulse_3s_ease-in-out_infinite]' : ''}`}
    >
      <div className="flex items-center justify-between gap-1">
        <p className={`text-[11px] font-semibold ${isTour ? 'text-blue-700' : 'text-purple-700'}`}>
          {formatTime(item.time)}
        </p>
        <span className={`px-1.5 py-0 rounded text-[9px] font-bold uppercase tracking-wider ${
          isTour ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
        }`}>{isTour ? 'Tour' : 'D1'}</span>
      </div>
      <p className="text-xs font-medium text-text-primary truncate leading-tight mt-0.5">{item.name}</p>
      {item.type === 'dayone' && item.trainer && (
        <p className="text-[10px] text-text-muted truncate">{item.trainer}</p>
      )}
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        {!(item.type === 'tour' && item.status !== 'Cancelled') && (
          <span className={`px-1.5 py-0 rounded text-[10px] font-medium border ${STATUS_COLORS[item.status] || STATUS_COLORS.Scheduled}`}>
            {item.status}
          </span>
        )}
        {item.type === 'dayone' && item.sale && (
          <span className={`px-1.5 py-0 rounded text-[10px] font-medium border ${
            item.sale === 'Sale' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-orange-50 text-orange-600 border-orange-200'
          }`}>{item.sale}</span>
        )}
      </div>
    </div>
  )
}
