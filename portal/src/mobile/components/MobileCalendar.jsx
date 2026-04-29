import { useState, useEffect, useRef } from 'react'
import { getDayOneTrackerAppointments, getTours } from '../../lib/api'
import MobileDayOneOutcomeModal from './MobileDayOneOutcomeModal'
import MobileLoading from './MobileLoading'

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

function normalizeStatus(apt) {
  const aptStatus = (apt.status || '').toLowerCase()
  if (aptStatus === 'cancelled') return 'Cancelled'
  const dayOneStatus = (apt.day_one_status || '').toLowerCase().replace(/\s+/g, '')
  if (dayOneStatus === 'completed') return 'Completed'
  if (dayOneStatus === 'noshow' || dayOneStatus === 'no-show' || dayOneStatus === 'no show') return 'No Show'
  return 'Scheduled'
}

function normalizeTourStatus(raw) {
  const s = (raw || '').toLowerCase().replace(/\s+/g, '')
  if (s === 'cancelled') return 'Cancelled'
  if (s === 'showed' || s === 'completed' || s === 'noshow') return 'Completed'
  return 'Scheduled'
}

function getSaleLabel(apt) {
  if (normalizeStatus(apt) !== 'Completed') return null
  return apt.day_one_sale || null
}

const STATUS_COLORS = {
  Scheduled: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  Completed: 'bg-green-50 text-green-700 border-green-200',
  'No Show': 'bg-red-50 text-red-500 border-red-200',
  Cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
}

export default function MobileCalendar({ user }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentDate, setCurrentDate] = useState(getDateStr())
  const [filter, setFilter] = useState('all')
  const [selectedDayOne, setSelectedDayOne] = useState(null)
  const requestRef = useRef(0)

  const userLocations = user?.staff?.locations || []
  const [selectedLocation, setSelectedLocation] = useState(
    userLocations.find(l => l.is_primary)?.name || userLocations[0]?.name || 'Salem'
  )
  const hasMultipleLocations = userLocations.length > 1
  const locationSlug = selectedLocation.toLowerCase()
  const locationId = userLocations.find(l => l.name === selectedLocation)?.id

  useEffect(() => {
    const id = ++requestRef.current
    setItems([])
    setLoading(true)
    setError('')

    const dateParams = { start_date: currentDate, end_date: currentDate }

    Promise.all([
      locationId
        ? getTours({ location_id: locationId, ...dateParams }).catch(() => ({ tours: [] }))
        : Promise.resolve({ tours: [] }),
      getDayOneTrackerAppointments({ location_slug: locationSlug, ...dateParams }).catch(() => ({ appointments: [] })),
    ]).then(([toursRes, dayOneRes]) => {
      if (id !== requestRef.current) return

      const tours = (toursRes.tours || []).map(t => ({
        id: t.id,
        type: 'tour',
        name: t.contact_name || t.title || 'Tour',
        time: t.start_time,
        status: normalizeTourStatus(t.status),
        phone: t.contact_phone,
        email: t.contact_email,
      }))

      const dayOnes = (dayOneRes.appointments || []).map(a => ({
        id: a.id,
        type: 'dayone',
        name: a.contact_name || 'Unknown',
        time: a.appointment_time,
        trainer: a.assigned_user_name,
        status: normalizeStatus(a),
        sale: getSaleLabel(a),
        pending: !a.day_one_status || a.day_one_status === 'Scheduled',
        raw: a,
      }))

      // Filter by selected date client-side to avoid timezone drift
      // (API may return adjacent-date events due to UTC vs local)
      const all = [...tours, ...dayOnes].filter(item => {
        if (!item.time) return false
        return toLocalDateStr(new Date(item.time)) === currentDate
      }).sort((a, b) => new Date(a.time) - new Date(b.time))
      setItems(all)
      setLoading(false)
    }).catch(err => {
      if (id === requestRef.current) { setError(err.message); setLoading(false) }
    })
  }, [currentDate, locationSlug, locationId])

  function navigateDate(offset) {
    const d = new Date(currentDate + 'T12:00:00')
    d.setDate(d.getDate() + offset)
    setCurrentDate(toLocalDateStr(d))
  }

  const todayStr = getDateStr()
  const filtered = filter === 'all' ? items : items.filter(i => i.type === filter)
  const pendingCount = items.filter(i => i.type === 'dayone' && i.pending).length
  const tourCount = items.filter(i => i.type === 'tour').length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-surface/95 backdrop-blur-sm border-b border-border px-4 pt-4 pb-3 space-y-3 sticky top-0 z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-text-primary">Calendar</h2>
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 text-[11px] font-medium border border-yellow-200">
                {pendingCount} pending
              </span>
            )}
          </div>
          {/* Filter Toggle */}
          <div className="flex bg-bg rounded-lg p-0.5">
            {[
              { key: 'all', label: 'All' },
              { key: 'tour', label: `Tours${tourCount ? ` (${tourCount})` : ''}` },
              { key: 'dayone', label: 'Day Ones' },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  filter === f.key ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted'
                }`}
              >{f.label}</button>
            ))}
          </div>
        </div>

        {/* Location pills */}
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
          <button onClick={() => navigateDate(-1)} className="p-2 text-text-muted active:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <p className="text-sm font-semibold text-text-primary truncate flex-1 text-center">{formatDate(currentDate)}</p>
          <div className="flex items-center gap-1">
            {currentDate !== todayStr && (
              <button
                onClick={() => setCurrentDate(getDateStr())}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-wcs-red text-wcs-red active:bg-wcs-red active:text-white transition-colors"
              >
                Today
              </button>
            )}
            <button onClick={() => navigateDate(1)} className="p-2 text-text-muted active:text-text-primary">
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

        {loading && <MobileLoading variant="appointments" count={4} className="px-0 py-0" />}

        {!loading && filtered.length === 0 && (
          <div className="bg-surface rounded-2xl border border-border shadow-sm px-5 py-6 mt-4 text-center">
            <p className="text-sm text-text-primary">No appointments for this day</p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map(item => {
              const isTour = item.type === 'tour'
              const isCompletedD1 = !isTour && (item.status === 'Completed' || item.status === 'No Show')
              const clickable = !isTour && (item.pending || isCompletedD1)
              return (
                <div
                  key={item.id}
                  onClick={clickable ? () => setSelectedDayOne(item) : undefined}
                  className={`bg-surface rounded-2xl border p-4 shadow-sm ${
                    item.pending ? 'border-yellow-300 cursor-pointer' : clickable ? 'border-border active:bg-bg cursor-pointer' : 'border-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-1.5 py-0 rounded text-[10px] font-bold uppercase tracking-wider ${
                          isTour ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                        }`}>{isTour ? 'Tour' : 'D1'}</span>
                        <p className="font-semibold text-text-primary truncate">{item.name}</p>
                      </div>
                      <p className="text-xs text-text-muted">{formatTime(item.time)}</p>
                      {!isTour && item.trainer && (
                        <p className="text-xs text-text-muted mt-0.5">Trainer: {item.trainer}</p>
                      )}
                      {isTour && item.phone && (
                        <p className="text-xs text-text-muted mt-0.5">{item.phone}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {!(isTour && item.status !== 'Cancelled') && (
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          STATUS_COLORS[item.status] || STATUS_COLORS.Scheduled
                        }`}>
                          {item.status}
                        </span>
                      )}
                      {!isTour && item.sale && (
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          item.sale === 'Sale' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-orange-50 text-orange-600 border-orange-200'
                        }`}>
                          {item.sale}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Day One Outcome Modal \u2014 fill the form for pending, review for completed */}
      {selectedDayOne && (
        <MobileDayOneOutcomeModal
          apt={selectedDayOne.raw}
          locationSlug={locationSlug}
          onClose={() => setSelectedDayOne(null)}
          onSubmitted={confirmed => {
            // Merge confirmed outcome into the local item so the calendar reflects it without a refetch
            setItems(prev => prev.map(i => {
              if (i.id !== selectedDayOne.id) return i
              const mergedRaw = { ...i.raw, ...confirmed }
              return {
                ...i,
                raw: mergedRaw,
                status: normalizeStatus(mergedRaw),
                sale: getSaleLabel(mergedRaw),
                pending: !mergedRaw.day_one_status || mergedRaw.day_one_status === 'Scheduled',
              }
            }))
            setSelectedDayOne(null)
          }}
        />
      )}
    </div>
  )
}
