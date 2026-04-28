import { useState, useEffect } from 'react'
import { getDayOneTrackerAppointments, submitDayOneResult, getDayOneFieldOptions } from '../lib/api'

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

function OutcomeModal({ appointment, locationSlug, onClose, onSubmitted }) {
  const [step, setStep] = useState(1) // 1=show/no-show, 2=sale/no-sale, 3=details, 4=review
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
      // Use confirmed status from GHL re-read
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
    if (value === 'No Show') {
      setStep(4) // Go to review
    } else {
      setStep(2)
    }
  }

  function handleSaleResult(value) {
    setSaleResult(value)
    setStep(3)
  }

  function handleDetailNext() {
    setStep(4) // Go to review
  }

  const alreadyDone = isCompleted(appointment)

  // Build review summary
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
            {appointment.assigned_user_name && (
              <p className="text-xs text-text-muted">Trainer: {appointment.assigned_user_name}</p>
            )}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>

        {alreadyDone && (
          <div className="mb-4 p-3 rounded-lg bg-bg border border-border">
            <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Current Status</p>
            <div className="flex items-center gap-2">
              <StatusBadge appointment={appointment} />
              {appointment.day_one_sale && (
                <span className="text-sm text-text-primary">{appointment.day_one_sale}</span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-2">You can update this result below.</p>
          </div>
        )}

        {error && <p className="text-wcs-red text-sm mb-4">{error}</p>}

        {/* Step 1: Show or No Show */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-primary text-center mb-4">Did they show up?</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => handleShowNoShow('Show')} className="py-6 rounded-xl bg-green-50 border-2 border-green-200 text-green-700 font-bold text-lg hover:bg-green-100 transition-colors">
                Show
              </button>
              <button onClick={() => handleShowNoShow('No Show')} className="py-6 rounded-xl bg-red-50 border-2 border-red-200 text-red-600 font-bold text-lg hover:bg-red-100 transition-colors">
                No Show
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Sale or No Sale */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-primary text-center mb-4">Sale or No Sale?</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => handleSaleResult('Sale')} className="py-6 rounded-xl bg-green-50 border-2 border-green-200 text-green-700 font-bold text-lg hover:bg-green-100 transition-colors">
                Sale
              </button>
              <button onClick={() => handleSaleResult('No Sale')} className="py-6 rounded-xl bg-gray-50 border-2 border-gray-200 text-gray-600 font-bold text-lg hover:bg-gray-100 transition-colors">
                No Sale
              </button>
            </div>
            <button onClick={() => { setShowNoShow(null); setStep(1) }} className="text-xs text-text-muted hover:text-text-primary mt-2">Back</button>
          </div>
        )}

        {/* Step 3: Details (sale type or no-sale reason) */}
        {step === 3 && saleResult === 'Sale' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-text-primary text-center">What did they sell?</p>
            <select value={ptSaleType} onChange={e => setPtSaleType(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red">
              <option value="">Select sale type...</option>
              {(fieldOptions?.pt_sale_types || []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <button onClick={handleDetailNext} disabled={!ptSaleType} className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50">
              Next
            </button>
            <button onClick={() => { setSaleResult(null); setStep(2) }} className="text-xs text-text-muted hover:text-text-primary">Back</button>
          </div>
        )}

        {step === 3 && saleResult === 'No Sale' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-text-primary text-center">Why no sale?</p>
            <textarea
              value={whyNoSale}
              onChange={e => setWhyNoSale(e.target.value)}
              placeholder="Enter reason..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red resize-none"
            />
            <button onClick={handleDetailNext} disabled={!whyNoSale.trim()} className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50">
              Next
            </button>
            <button onClick={() => { setSaleResult(null); setStep(2) }} className="text-xs text-text-muted hover:text-text-primary">Back</button>
          </div>
        )}

        {/* Step 4: Review & Submit */}
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
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Submit'}
            </button>
            <button
              onClick={() => {
                // Go back to the appropriate step to edit
                if (showNoShow === 'No Show') setStep(1)
                else if (saleResult === 'Sale') setStep(3)
                else if (saleResult === 'No Sale') setStep(3)
                else setStep(2)
              }}
              className="w-full py-2 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Edit answers
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DayOneTrackerView({ user, onBack, location, isAdmin }) {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const defaultSlug = (location || 'Salem').toLowerCase()
  const [locationSlug, setLocationSlug] = useState(defaultSlug)
  const [activeModal, setActiveModal] = useState(null)
  const [tab, setTab] = useState('pending')

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
      {loading && <p className="mx-auto w-fit bg-surface text-text-primary text-sm px-4 py-2 my-6 rounded-lg border border-border shadow-sm block">Loading Day One appointments...</p>}

      {!loading && (
        <div className="flex flex-col gap-2">
          {visibleList.map(apt => (
            <button
              key={apt.id}
              onClick={() => setActiveModal(apt)}
              className="w-full flex items-center justify-between p-4 rounded-xl bg-surface border border-border hover:border-wcs-red/50 transition-colors text-left"
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
          ))}
          {visibleList.length === 0 && (
            <p className="mx-auto w-fit bg-surface text-text-primary text-sm px-4 py-2 my-6 rounded-lg border border-border shadow-sm block">
              {tab === 'pending' ? 'No pending Day Ones' : 'No completed Day Ones'} for this period
            </p>
          )}
        </div>
      )}

      {activeModal && (
        <OutcomeModal
          appointment={activeModal}
          locationSlug={locationSlug}
          onClose={() => setActiveModal(null)}
          onSubmitted={(confirmedFields) => {
            // Update local state with GHL-confirmed status
            setAppointments(prev => prev.map(a =>
              a.id === activeModal.id ? { ...a, ...confirmedFields } : a
            ))
            setActiveModal(null)
          }}
        />
      )}
    </div>
  )
}
