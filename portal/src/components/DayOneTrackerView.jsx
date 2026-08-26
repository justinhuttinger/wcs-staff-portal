import { useState, useEffect } from 'react'
import { getDayOneTrackerAppointments } from '../lib/api'
import DayOneOutcomeModal from './DayOneOutcomeModal'

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

import { LOCATION_NAMES } from '../config/locations'
const LOCATIONS = LOCATION_NAMES.map(name => ({ slug: name.toLowerCase(), label: name }))

function isPast(iso) {
  if (!iso) return false
  return new Date(iso) < new Date()
}

function isCancelled(apt) {
  const s = (apt.status || '').toLowerCase().replace(/\s+/g, '')
  return s === 'cancelled'
}

function isPending(apt) {
  if (isCancelled(apt)) return false
  const s = (apt.day_one_status || '').toLowerCase()
  return (!s || s === 'scheduled' || s === 'confirmed') && isPast(apt.appointment_time)
}

function isCompleted(apt) {
  if (isCancelled(apt)) return false
  const s = (apt.day_one_status || '').toLowerCase()
  return s === 'completed' || s === 'no show' || apt.show_or_no_show === 'No Show'
}

function StatusBadge({ appointment }) {
  const s = appointment.day_one_status
  const sale = appointment.day_one_sale
  const apptStatus = (appointment.status || '').toLowerCase().replace(/\s+/g, '')
  if (apptStatus === 'cancelled') {
    return <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-500 text-xs border border-red-200">Cancelled</span>
  }
  if (s === 'No Show' || appointment.show_or_no_show === 'No Show') {
    return <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs border border-red-200">No Show</span>
  }
  if (s === 'Completed') {
    if (sale === 'Sale') {
      return <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">Sale</span>
    }
    if (sale === 'No Sale') {
      return <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 text-xs border border-gray-200">No Sale</span>
    }
    return <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">Completed</span>
  }
  return <span className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 text-xs border border-yellow-200">Scheduled</span>
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function DayOneTrackerView({ user, onBack, location, isAdmin }) {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const defaultSlug = (location || 'Salem').toLowerCase()
  const [locationSlug, setLocationSlug] = useState(defaultSlug)
  const [activeModal, setActiveModal] = useState(null)
  const [tab, setTab] = useState('pending')

  // Completion gate: only manager+ can record a Day One that isn't assigned to
  // them. Everyone below manager (team members and leads) can record only their
  // own. Everyone still sees every row.
  const COMPLETE_ANY_ROLES = ['manager', 'corporate', 'director', 'marketing', 'admin']
  const canCompleteAny = COMPLETE_ANY_ROLES.includes(user?.staff?.role)
  const userEmail = (user?.staff?.email || '').toLowerCase()
  const canCompleteApt = (apt) => canCompleteAny || (apt.assigned_user_email || '').toLowerCase() === userEmail

  useEffect(() => { loadAppointments() }, [locationSlug])

  async function loadAppointments() {
    setLoading(true)
    setError('')
    try {
      const params = { location_slug: locationSlug }
      const urlStartDate = new URLSearchParams(window.location.search).get('start_date')
      if (urlStartDate) params.start_date = urlStartDate
      const res = await getDayOneTrackerAppointments(params)
      setAppointments(res.appointments || [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  // Filter out future appointments — only show past ones
  const pastAppointments = appointments.filter(a => isPast(a.appointment_time))
  const pending = pastAppointments.filter(isPending).sort((a, b) => new Date(a.appointment_time) - new Date(b.appointment_time))
  const completed = pastAppointments.filter(isCompleted).sort((a, b) => new Date(b.appointment_time) - new Date(a.appointment_time))
  const visibleList = tab === 'pending' ? pending : completed

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-6">
      <div className="mb-5">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors mb-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Portal
          </button>
        )}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-primary">Day One Tracker</h2>
          {pending.length > 0 && (
            <span className="px-3 py-1 rounded-full bg-yellow-50 text-yellow-700 text-sm font-medium border border-yellow-200">
              {pending.length} pending
            </span>
          )}
        </div>
      </div>

      {/* Location Selector (admin only) */}
      {isAdmin ? (
        <div className="flex flex-wrap gap-2 mb-4">
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
        <p className="text-xs text-text-muted mb-4 uppercase tracking-wide font-semibold">{location}</p>
      )}

      {/* Pending / Completed Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setTab('pending')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'pending'
              ? 'border-wcs-red text-wcs-red'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          Pending ({pending.length})
        </button>
        <button
          onClick={() => setTab('completed')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'completed'
              ? 'border-wcs-red text-wcs-red'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          Completed ({completed.length})
        </button>
      </div>

      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}
      {loading && <p className="loading-card mx-auto block my-6">Loading Day One appointments...</p>}

      {!loading && (
        <div className="flex flex-col gap-2">
          {visibleList.map(apt => {
            const clickable = canCompleteApt(apt)
            return (
            <button
              key={apt.id}
              onClick={clickable ? () => setActiveModal(apt) : undefined}
              disabled={!clickable}
              className={`w-full flex items-center justify-between p-4 rounded-xl bg-surface border border-border text-left transition-colors ${
                clickable ? 'hover:border-wcs-red/50 cursor-pointer' : 'cursor-default'
              }`}
            >
              <div>
                <p className="font-medium text-text-primary">{capitalize(apt.contact_name)}</p>
                <p className="text-xs text-text-muted mt-0.5">{formatDateTime(apt.appointment_time)}</p>
                {apt.assigned_user_name && (
                  <p className="text-xs text-text-muted">Trainer: {apt.assigned_user_name}</p>
                )}
              </div>
              <StatusBadge appointment={apt} />
            </button>
            )
          })}
          {visibleList.length === 0 && (
            <p className="empty-card mx-auto block my-6">
              {tab === 'pending' ? 'No pending Day Ones' : 'No completed Day Ones'} for this period
            </p>
          )}
        </div>
      )}

      {activeModal && (
        <DayOneOutcomeModal
          appointment={activeModal}
          onClose={() => setActiveModal(null)}
          onRecorded={() => {
            // The embedded form owns the write, so it reports completion rather
            // than handing back fields to merge. Refetching is both simpler and
            // more honest than patching local state with a guess at the result.
            setActiveModal(null)
            loadAppointments()
          }}
        />
      )}
    </div>
  )
}
