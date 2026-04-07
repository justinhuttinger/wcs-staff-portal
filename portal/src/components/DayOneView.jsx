import { useState, useEffect } from 'react'
import { getAppointments } from '../lib/api'
import AppointmentCard from './AppointmentCard'

export default function DayOneView({ user, onBack }) {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('pending')
  const [trainerFilter, setTrainerFilter] = useState('')
  const [formOverlay, setFormOverlay] = useState(null)

  const isManager = ['manager', 'director', 'admin'].includes(user?.staff?.role)

  useEffect(() => { loadAppointments() }, [statusFilter, trainerFilter])

  async function loadAppointments() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      if (trainerFilter) params.staff_id = trainerFilter
      const res = await getAppointments(params)
      setAppointments(res.appointments || [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  function openForm(appointment) {
    if (appointment.form_url && appointment.status === 'pending') {
      setFormOverlay(appointment)
    }
  }

  // Get unique trainers for filter
  const trainers = [...new Map(
    appointments.map(a => [a.staff_id, { id: a.staff_id, email: a.staff_email }])
  ).values()].filter(t => t.id)

  const pendingCount = appointments.filter(a => a.status === 'pending').length

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Portal
          </button>
          <h2 className="text-xl font-bold text-text-primary">Day One Tracking</h2>
        </div>
        {pendingCount > 0 && (
          <span className="px-3 py-1 rounded-full bg-yellow-50 text-yellow-700 text-sm font-medium border border-yellow-200">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="flex gap-1 bg-bg rounded-lg p-1">
          {['pending', 'completed', ''].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === status
                  ? 'bg-surface text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {status === '' ? 'All' : status === 'pending' ? 'Pending' : 'Completed'}
            </button>
          ))}
        </div>

        {isManager && trainers.length > 1 && (
          <select
            value={trainerFilter}
            onChange={e => setTrainerFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-wcs-red"
          >
            <option value="">All Trainers</option>
            {trainers.map(t => (
              <option key={t.id} value={t.id}>{t.email}</option>
            ))}
          </select>
        )}

        <button
          onClick={loadAppointments}
          className="px-3 py-1.5 rounded-lg border border-border text-text-muted text-xs hover:text-text-primary transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}

      {/* Loading */}
      {loading && <p className="text-text-muted text-sm py-8 text-center">Loading appointments...</p>}

      {/* Appointment Cards */}
      {!loading && (
        <div className="flex flex-col gap-3">
          {appointments.length === 0 && (
            <p className="text-text-muted text-sm py-8 text-center">No appointments found</p>
          )}
          {appointments.map(apt => (
            <AppointmentCard
              key={apt.id}
              appointment={apt}
              onClick={() => openForm(apt)}
            />
          ))}
        </div>
      )}

      {/* Form Overlay (iframe) */}
      {formOverlay && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-2xl border border-border w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="text-base font-semibold text-text-primary">{formOverlay.contact_name}</h3>
                <p className="text-xs text-text-muted">Day One Form</p>
              </div>
              <button
                onClick={() => { setFormOverlay(null); loadAppointments() }}
                className="text-text-muted hover:text-text-primary text-xl"
              >
                &times;
              </button>
            </div>
            <iframe
              src={formOverlay.form_url}
              className="flex-1 w-full border-0"
              title="Day One Form"
            />
          </div>
        </div>
      )}
    </div>
  )
}
