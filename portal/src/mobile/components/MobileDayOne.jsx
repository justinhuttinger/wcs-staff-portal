import React, { useState, useEffect, useCallback } from 'react'
import { getDayOneTrackerAppointments } from '../../lib/api'
import MobileDayOneOutcomeModal, { isCancelled, isCompleted } from './MobileDayOneOutcomeModal'
import MobileLoading from './MobileLoading'

const LOCATIONS = [
  { slug: 'salem', label: 'Salem' },
  { slug: 'keizer', label: 'Keizer' },
  { slug: 'eugene', label: 'Eugene' },
  { slug: 'springfield', label: 'Springfield' },
  { slug: 'clackamas', label: 'Clackamas' },
  { slug: 'milwaukie', label: 'Milwaukie' },
  { slug: 'medford', label: 'Medford' },
]

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}
function isPast(iso) { return iso ? new Date(iso) < new Date() : false }
function isPending(apt) {
  if (isCancelled(apt)) return false
  const s = (apt.day_one_status || '').toLowerCase()
  return (!s || s === 'scheduled' || s === 'confirmed') && isPast(apt.appointment_time)
}
function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ apt }) {
  const status = (apt.day_one_status || '').toLowerCase()
  const showNoShow = apt.show_or_no_show
  const apptStatus = (apt.status || '').toLowerCase().replace(/\s+/g, '')

  let label, colorClass
  if (apptStatus === 'cancelled') {
    label = 'Cancelled'
    colorClass = 'bg-red-50 text-red-500 border-red-200'
  } else if (status === 'no show' || showNoShow === 'No Show') {
    label = 'No Show'
    colorClass = 'bg-red-50 text-red-600 border-red-200'
  } else if (status === 'completed' && apt.sale_type) {
    label = 'Sale'
    colorClass = 'bg-green-50 text-green-700 border-green-200'
  } else if (status === 'completed' && apt.no_sale_reason) {
    label = 'No Sale'
    colorClass = 'bg-gray-50 text-gray-500 border-gray-200'
  } else if (status === 'completed') {
    label = 'Completed'
    colorClass = 'bg-green-50 text-green-700 border-green-200'
  } else {
    label = 'Scheduled'
    colorClass = 'bg-yellow-50 text-yellow-700 border-yellow-200'
  }

  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${colorClass}`}>
      {label}
    </span>
  )
}

export default function MobileDayOne({ user }) {
  const [tab, setTab] = useState('pending')
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedApt, setSelectedApt] = useState(null)
  const [selectedReadOnly, setSelectedReadOnly] = useState(false)

  const isAdmin = user?.staff?.role === 'admin' || user?.staff?.role === 'director'
  const defaultSlug = (
    user?.staff?.locations?.find(l => l.is_primary)?.name ||
    user?.staff?.locations?.[0]?.name ||
    'salem'
  ).toLowerCase()
  const [locationSlug, setLocationSlug] = useState(defaultSlug)

  const fetchAppointments = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getDayOneTrackerAppointments({ location_slug: locationSlug })
      setAppointments(res.appointments || res.data || res || [])
    } catch (err) {
      console.error('Failed to fetch day one appointments:', err)
      setAppointments([])
    } finally {
      setLoading(false)
    }
  }, [locationSlug])

  useEffect(() => { fetchAppointments() }, [fetchAppointments])

  const pendingList = appointments.filter(isPending)
  const completedList = appointments.filter(isCompleted)
  const displayList = tab === 'pending' ? pendingList : completedList

  function handleAptClick(apt) {
    setSelectedReadOnly(false)
    setSelectedApt(apt)
  }

  function handleSubmitted(confirmedFields) {
    setAppointments(prev => prev.map(a =>
      a.id === selectedApt.id ? { ...a, ...confirmedFields } : a
    ))
    setSelectedApt(null)
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      <div className="px-4 pt-4 pb-2">
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab('pending')}
            className={`flex-1 pb-3 text-sm font-semibold text-center transition-colors ${
              tab === 'pending' ? 'text-wcs-red border-b-2 border-wcs-red' : 'text-text-muted'
            }`}
          >
            Pending ({pendingList.length})
          </button>
          <button
            onClick={() => setTab('completed')}
            className={`flex-1 pb-3 text-sm font-semibold text-center transition-colors ${
              tab === 'completed' ? 'text-wcs-red border-b-2 border-wcs-red' : 'text-text-muted'
            }`}
          >
            Completed ({completedList.length})
          </button>
        </div>
      </div>

      {isAdmin && (
        <div className="px-4 pb-2 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {LOCATIONS.map(loc => (
              <button
                key={loc.slug}
                onClick={() => setLocationSlug(loc.slug)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border whitespace-nowrap transition-colors ${
                  locationSlug === loc.slug
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-surface text-text-secondary border-border'
                }`}
              >
                {loc.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <MobileLoading text="Loading..." className="py-16" />
        ) : displayList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 mb-2 opacity-40">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">
              {tab === 'pending' ? 'No pending appointments' : 'No completed appointments'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-2">
            {displayList.map((apt, i) => (
              <button
                key={apt.id || i}
                onClick={() => handleAptClick(apt)}
                className="w-full text-left bg-surface rounded-2xl border border-border p-4 flex items-start gap-3 active:bg-bg transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary truncate">
                    {capitalize(apt.contact_name || apt.name || 'Unknown')}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {formatDateTime(apt.appointment_time)}
                  </p>
                  {apt.trainer_name && (
                    <p className="text-xs text-text-muted mt-0.5">
                      Trainer: {apt.trainer_name}
                    </p>
                  )}
                </div>
                <StatusBadge apt={apt} />
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedApt && (
        <MobileDayOneOutcomeModal
          apt={selectedApt}
          locationSlug={locationSlug}
          onClose={() => setSelectedApt(null)}
          onSubmitted={handleSubmitted}
          readOnly={selectedReadOnly}
        />
      )}
    </div>
  )
}
